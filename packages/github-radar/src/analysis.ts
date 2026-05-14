import type { GitHubRepo, RepoAnalysis, RepoSnapshot, StickySignal } from './types.js';
import { generateIdeas } from './ideas.js';

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  const diff = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  return Math.max(diff / DAY_MS, 0.001);
}

function calcMomentum(args: {
  repo: GitHubRepo;
  snapshot?: RepoSnapshot;
  nowIso: string;
}): { momentumScore: number; deltaStarsPerDay: number; deltaForksPerDay: number; confidence: number } {
  const { repo, snapshot, nowIso } = args;

  const ageDays = daysBetween(repo.created_at, nowIso);
  const baselineStarVelocity = repo.stargazers_count / ageDays;

  let deltaStarsPerDay = baselineStarVelocity;
  let deltaForksPerDay = repo.forks_count / ageDays;
  let confidence = 0.45;

  if (snapshot) {
    const elapsed = daysBetween(snapshot.capturedAt, nowIso);
    deltaStarsPerDay = (repo.stargazers_count - snapshot.stars) / elapsed;
    deltaForksPerDay = (repo.forks_count - snapshot.forks) / elapsed;
    confidence = Math.min(1, 0.65 + elapsed / 14);
  }

  const issuesPenalty = Math.min(1, repo.open_issues_count / Math.max(repo.stargazers_count, 1));
  const watchersLift = repo.watchers_count / Math.max(repo.stargazers_count, 1);

  const momentumScore =
    deltaStarsPerDay * 0.6 +
    deltaForksPerDay * 0.25 +
    watchersLift * 50 -
    issuesPenalty * 20;

  return { momentumScore, deltaStarsPerDay, deltaForksPerDay, confidence };
}

function calcStickySignals(repo: GitHubRepo): StickySignal[] {
  const topicCount = repo.topics?.length ?? 0;
  const desc = repo.description ?? '';

  const onboardingScore = /quick|simple|easy|starter|boilerplate/i.test(desc) ? 18 : 8;
  const distributionScore = topicCount >= 6 ? 18 : topicCount >= 3 ? 12 : 6;
  const ecosystemScore = repo.homepage ? 16 : 9;
  const wowScore = /ai|agent|copilot|realtime|instant/i.test(desc) ? 18 : 9;
  const retentionScore = repo.open_issues_count < 150 ? 14 : 8;

  return [
    {
      key: 'onboarding-speed',
      score: onboardingScore,
      evidence: 'Repo messaging indicates rapid setup/value realization.',
    },
    {
      key: 'distribution-loop',
      score: distributionScore,
      evidence: `Topic footprint (${topicCount}) suggests discoverability and shareability.`,
    },
    {
      key: 'ecosystem-surface',
      score: ecosystemScore,
      evidence: repo.homepage ? 'External surface/homepage exists for conversion.' : 'Limited external surface; ecosystem mostly on GitHub.',
    },
    {
      key: 'time-to-wow',
      score: wowScore,
      evidence: 'Description signals immediate visible outcome.',
    },
    {
      key: 'community-maintainability',
      score: retentionScore,
      evidence: 'Issue pressure relative to popularity indicates maintainability.',
    },
  ];
}

export function analyzeRepos(args: {
  repos: GitHubRepo[];
  snapshotMap: Map<string, RepoSnapshot | undefined>;
  nowIso: string;
}): RepoAnalysis[] {
  const output: RepoAnalysis[] = [];

  for (const repo of args.repos) {
    const prev = args.snapshotMap.get(repo.full_name);
    const { momentumScore, deltaStarsPerDay, deltaForksPerDay, confidence } = calcMomentum({
      repo,
      snapshot: prev,
      nowIso: args.nowIso,
    });

    const stickySignals = calcStickySignals(repo);
    const stickyScore = stickySignals.reduce((sum, row) => sum + row.score, 0);
    const ideaPrompts = generateIdeas(repo, stickySignals);

    output.push({
      repo,
      momentumScore,
      stickyScore,
      deltaStarsPerDay,
      deltaForksPerDay,
      confidence,
      stickySignals,
      ideaPrompts,
    });
  }

  return output.sort((a, b) => b.momentumScore + b.stickyScore - (a.momentumScore + a.stickyScore));
}
