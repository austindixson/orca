import type { RadarConfig } from './types.js';

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfigFromEnv(): RadarConfig {
  return {
    token: process.env.GITHUB_TOKEN,
    maxRepos: parseIntSafe(process.env.RADAR_MAX_REPOS, 60),
    outputDir: process.env.RADAR_OUTPUT_DIR ?? 'out',
    minStars: parseIntSafe(process.env.RADAR_MIN_STARS, 500),
    lookbackDays: parseIntSafe(process.env.RADAR_LOOKBACK_DAYS, 7),
  };
}

export function parseArgOverrides(argv: string[]): Partial<RadarConfig> {
  const overrides: Partial<RadarConfig> = {};

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    switch (current) {
      case '--max-repos':
        overrides.maxRepos = Number.parseInt(next ?? '', 10);
        i += 1;
        break;
      case '--min-stars':
        overrides.minStars = Number.parseInt(next ?? '', 10);
        i += 1;
        break;
      case '--output-dir':
        overrides.outputDir = next;
        i += 1;
        break;
      case '--lookback-days':
        overrides.lookbackDays = Number.parseInt(next ?? '', 10);
        i += 1;
        break;
      default:
        break;
    }
  }

  return overrides;
}
