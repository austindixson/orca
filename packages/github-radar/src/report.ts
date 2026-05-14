import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoAnalysis } from './types.js';

function formatNum(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

export async function writeReports(args: {
  outputDir: string;
  nowIso: string;
  analyses: RepoAnalysis[];
}): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(args.outputDir, { recursive: true });
  const stamp = args.nowIso.replace(/[:.]/g, '-');

  const jsonPath = join(args.outputDir, `radar-${stamp}.json`);
  const markdownPath = join(args.outputDir, `radar-${stamp}.md`);

  const top = args.analyses.slice(0, 25);

  const markdown = [
    '# GitHub Rising Radar',
    '',
    `Generated: ${args.nowIso}`,
    '',
    '## Top Rising Repos',
    '',
    ...top.flatMap((row, idx) => {
      const topSignal = [...row.stickySignals].sort((a, b) => b.score - a.score)[0];
      return [
        `### ${idx + 1}. ${row.repo.full_name}`,
        `- URL: ${row.repo.html_url}`,
        `- Momentum score: ${formatNum(row.momentumScore)} | Sticky score: ${formatNum(row.stickyScore)} | Confidence: ${formatNum(row.confidence)}`,
        `- Velocity: stars/day ${formatNum(row.deltaStarsPerDay)} | forks/day ${formatNum(row.deltaForksPerDay)}`,
        `- Why sticky: ${topSignal?.key ?? 'distribution'} — ${topSignal?.evidence ?? 'n/a'}`,
        '- Project ideas:',
        ...row.ideaPrompts.map((idea) => `  - ${idea}`),
        '',
      ];
    }),
  ].join('\n');

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(args.analyses, null, 2), 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
  ]);

  return { jsonPath, markdownPath };
}
