# GitHub Radar

Scanner for fastest-rising/sticky GitHub projects with automatic idea generation.

## What it does
- Pulls top GitHub repos by star popularity
- Computes momentum from star/fork velocity using local snapshots
- Scores stickiness via onboarding/distribution/ecosystem/time-to-wow/community heuristics
- Generates 3 project ideas per repo (niche clone, B2B layer, privacy-first edition)
- Writes timestamped JSON + Markdown reports

## Usage

From repo root:

```bash
npm run radar:scan
```

Or with overrides:

```bash
npm run radar:scan -- --max-repos 80 --min-stars 1000 --lookback-days 7 --output-dir packages/github-radar/out
```

## Environment variables
- `GITHUB_TOKEN` (recommended for higher GitHub API limits)
- `RADAR_MAX_REPOS` (default 60)
- `RADAR_MIN_STARS` (default 500)
- `RADAR_OUTPUT_DIR` (default `out`)
- `RADAR_LOOKBACK_DAYS` (default `7`, filters for recently pushed repos)

## Scripts
- `npm run dev --workspace=packages/github-radar`
- `npm run build --workspace=packages/github-radar`
- `npm run test --workspace=packages/github-radar`

## Output
- `out/radar-<timestamp>.json`
- `out/radar-<timestamp>.md`
- `out/snapshots.json`
