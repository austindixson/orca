import type { GitHubRepo, StickySignal } from './types.js';

function topSignal(signals: StickySignal[]): string {
  const first = [...signals].sort((a, b) => b.score - a.score)[0];
  return first ? first.key : 'distribution';
}

export function generateIdeas(repo: GitHubRepo, signals: StickySignal[]): string[] {
  const dominant = topSignal(signals);
  const language = repo.language ?? 'TypeScript';
  const nicheBase = repo.name.replace(/[-_]/g, ' ');

  return [
    `Niche vertical clone: build a ${nicheBase} variant for legal/healthcare workflows with templates and compliance defaults (dominant hook: ${dominant}).`,
    `B2B ops layer: wrap ${repo.full_name} patterns into a team dashboard with audit logs, role permissions, and paid seats using ${language}.`,
    `Privacy-first local edition: ship an offline-first desktop/self-host version inspired by ${repo.full_name} with one-click onboarding and import/export.`
  ];
}
