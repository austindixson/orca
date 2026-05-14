import assert from 'node:assert/strict';
import test from 'node:test';
import { generateIdeas } from './ideas.js';
import type { GitHubRepo, StickySignal } from './types.js';

const repo: GitHubRepo = {
  id: 1,
  name: 'super-project',
  full_name: 'acme/super-project',
  description: 'Simple realtime workflow tool',
  html_url: 'https://github.com/acme/super-project',
  stargazers_count: 500,
  forks_count: 40,
  open_issues_count: 10,
  watchers_count: 500,
  language: 'Go',
  topics: ['workflow', 'realtime'],
  homepage: null,
  created_at: new Date().toISOString(),
  pushed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const signals: StickySignal[] = [
  { key: 'distribution-loop', score: 15, evidence: 'Strong social diffusion' },
  { key: 'time-to-wow', score: 18, evidence: 'Immediate payoff' },
];

test('generateIdeas returns 3 execution-ready prompts', () => {
  const ideas = generateIdeas(repo, signals);

  assert.equal(ideas.length, 3);
  assert.ok(ideas[0].includes('super project'));
  assert.ok(ideas[1].includes('Go'));
  assert.ok(ideas[2].includes('offline-first'));
});
