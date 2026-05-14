#!/usr/bin/env node
import { analyzeRepos } from './analysis.js';
import { loadConfigFromEnv, parseArgOverrides } from './config.js';
import { fetchTrendingRepos } from './github.js';
import { writeReports } from './report.js';
import { appendSnapshots, getLatestSnapshot, readSnapshots } from './storage.js';
import type { RepoSnapshot } from './types.js';

async function main(): Promise<void> {
  const base = loadConfigFromEnv();
  const overrides = parseArgOverrides(process.argv);
  const config = { ...base, ...overrides };

  if (!Number.isFinite(config.maxRepos) || config.maxRepos <= 0) {
    throw new Error('maxRepos must be a positive integer');
  }

  const nowIso = new Date().toISOString();
  const repos = await fetchTrendingRepos({
    token: config.token,
    maxRepos: config.maxRepos,
    minStars: config.minStars,
    lookbackDays: config.lookbackDays,
  });

  const db = await readSnapshots(config.outputDir);
  const snapshotMap = new Map(repos.map((repo) => [repo.full_name, getLatestSnapshot(db, repo.full_name)]));

  const analyses = analyzeRepos({
    repos,
    snapshotMap,
    nowIso,
  });

  const snapshots: RepoSnapshot[] = repos.map((repo) => ({
    fullName: repo.full_name,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    watchers: repo.watchers_count,
    capturedAt: nowIso,
  }));

  await appendSnapshots(config.outputDir, snapshots);
  const report = await writeReports({
    outputDir: config.outputDir,
    nowIso,
    analyses,
  });

  const top = analyses.slice(0, 10);
  console.log(`GitHub Radar complete. Scanned ${repos.length} repos.`);
  console.log(`JSON report: ${report.jsonPath}`);
  console.log(`Markdown report: ${report.markdownPath}`);
  console.log('');
  console.log('Top opportunities:');
  for (const [index, row] of top.entries()) {
    const idea = row.ideaPrompts[0] ?? 'n/a';
    console.log(
      `${index + 1}. ${row.repo.full_name} | momentum ${row.momentumScore.toFixed(2)} | sticky ${row.stickyScore.toFixed(2)} | idea: ${idea}`,
    );
  }
}

main().catch((error) => {
  console.error('github-radar failed:', error);
  process.exitCode = 1;
});
