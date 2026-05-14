export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  language: string | null;
  topics?: string[];
  homepage?: string | null;
  created_at: string;
  pushed_at: string;
  updated_at: string;
};

export type RepoSnapshot = {
  fullName: string;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  capturedAt: string;
};

export type StickySignal = {
  key: string;
  score: number;
  evidence: string;
};

export type RepoAnalysis = {
  repo: GitHubRepo;
  momentumScore: number;
  stickyScore: number;
  deltaStarsPerDay: number;
  deltaForksPerDay: number;
  confidence: number;
  stickySignals: StickySignal[];
  ideaPrompts: string[];
};

export type RadarConfig = {
  token?: string;
  maxRepos: number;
  outputDir: string;
  minStars: number;
  lookbackDays: number;
};
