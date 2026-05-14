import type { GitHubRepo } from './types.js';

const BASE_URL = 'https://api.github.com';

type SearchResponse = {
  items: GitHubRepo[];
};

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'orca-github-radar',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function fetchTrendingRepos(args: {
  token?: string;
  maxRepos: number;
  minStars: number;
  lookbackDays: number;
}): Promise<GitHubRepo[]> {
  const perPage = Math.min(Math.max(args.maxRepos, 1), 100);
  const lookbackDate = new Date(Date.now() - Math.max(args.lookbackDays, 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const url = new URL(`${BASE_URL}/search/repositories`);
  url.searchParams.set('q', `stars:>=${args.minStars} pushed:>=${lookbackDate}`);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(perPage));

  const response = await fetch(url, {
    headers: buildHeaders(args.token),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub search failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as SearchResponse;
  return data.items;
}

export async function fetchRepo(args: { token?: string; fullName: string }): Promise<GitHubRepo> {
  const url = `${BASE_URL}/repos/${args.fullName}`;
  const response = await fetch(url, {
    headers: buildHeaders(args.token),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub repo fetch failed (${response.status}) for ${args.fullName}: ${body}`);
  }

  return (await response.json()) as GitHubRepo;
}
