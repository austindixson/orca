import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRepos } from './analysis.js';
import type { GitHubRepo, RepoSnapshot } from './types.js';

const baseRepo: GitHubRepo = {
  id: 1,
  name: 'fast-ai',
  full_name: 'acme/fast-ai',
  description: 'Easy AI agent starter with instant wow results',
  html_url: 'https://github.com/acme/fast-ai',
  stargazers_count: 1000,
  forks_count: 120,
  open_issues_count: 20,
  watchers_count: 1000,
  language: 'TypeScript',
  topics: ['ai', 'agent', 'starter', 'automation'],
  homepage: 'https://example.com',
  created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  pushed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

test('analyzeRepos prefers higher momentum/sticky opportunities', () => {
  const now = new Date().toISOString();
  const slowRepo: GitHubRepo = {
    ...baseRepo,
    id: 2,
    name: 'slow-tool',
    full_name: 'acme/slow-tool',
    description: 'Legacy utility',
    stargazers_count: 300,
    forks_count: 20,
    open_issues_count: 160,
    watchers_count: 100,
    topics: ['tools'],
    homepage: null,
  };

  const prev: RepoSnapshot = {
    fullName: baseRepo.full_name,
    stars: 900,
    forks: 100,
    openIssues: 20,
    watchers: 900,
    capturedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  };

  const rows = analyzeRepos({
    repos: [slowRepo, baseRepo],
    nowIso: now,
    snapshotMap: new Map([
      [baseRepo.full_name, prev],
      [slowRepo.full_name, undefined],
    ]),
  });

  assert.equal(rows[0].repo.full_name, baseRepo.full_name);
  assert.ok(rows[0].momentumScore > rows[1].momentumScore);
  assert.equal(rows[0].ideaPrompts.length, 3);
});
