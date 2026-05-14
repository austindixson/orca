# CI/CD Pipeline Documentation

This document describes the CI/CD pipeline setup for Orca Coder.

## Overview

The CI pipeline uses GitHub Actions to automatically:

1. **Lint and type check** all code on every push and pull request
2. **Run tests** for both Node.js and Rust components
3. **Collect and upload coverage** reports to Codecov
4. **Build artifacts** for all components
5. **Upload build artifacts** for later deployment

## Workflow Configuration

### File: `.github/workflows/ci.yml`

The main CI workflow consists of 6 jobs:

#### 1. Lint & Type Check
- Runs on every push and pull request
- Checks TypeScript compilation for all packages
- Runs `cargo fmt --check` for Rust formatting
- Runs `cargo clippy` for Rust linting

#### 2. Test Node.js packages
- Runs after lint job passes
- Tests `packages/client` and `packages/server`
- Uses `c8` for coverage collection
- Uploads coverage to Codecov with appropriate flags

#### 3. Test Rust packages
- Runs after lint job passes
- Tests all Rust workspace members
- Uses `cargo-tarpaulin` for coverage
- Uploads coverage to Codecov with Rust flag

#### 4. Build artifacts
- Runs after all test jobs pass
- Builds all components:
  - Client (Vite)
  - Server (TypeScript)
  - Harness-headless
  - Rust server, daemon, and CLI
- Uploads artifacts with 30-day retention

#### 5. Coverage Report
- Runs after all jobs complete (always)
- Generates summary in GitHub Actions UI
- Provides overview of coverage across all components

#### 6. Status Check
- Aggregates results from all jobs
- Fails the overall CI check if any job fails

## Triggers

The CI workflow runs on:

- **Push** to branches:
  - `main`
  - `develop`
  - `feature/**`
  - `bugfix/**`
- **Pull requests** targeting:
  - `main`
  - `develop`

## Coverage Reporting

### Configuration Files

#### `packages/client/.c8rc.json`
- Configures `c8` coverage tool for client
- Excludes test files and test utilities
- Outputs text, lcov, and HTML reports

#### `packages/server/.c8rc.json`
- Configures `c8` coverage tool for server
- Excludes test files and dist directory
- Outputs text, lcov, and HTML reports

#### `codecov.yml` (repo root)
- Configures Codecov behavior
- Sets coverage thresholds (informational)
- Defines ignore patterns for test files
- Configures PR comments with coverage diff

### Coverage Collection

**Node.js packages:**
```bash
NODE_ENV=test c8 npm run test --workspace=packages/client
```

**Rust packages:**
```bash
cargo tarpaulin --workspace --out Xml --output-dir ./coverage
```

### Uploading Coverage

Coverage is uploaded automatically via the `codecov/codecov-action@v4` action:

```yaml
- name: Upload client coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./packages/client/coverage/lcov.info
    flags: client
    name: client-coverage
    fail_ci_if_error: false
```

## Artifact Storage

Build artifacts are uploaded with the `actions/upload-artifact@v4` action:

- **Client dist**: `packages/client/dist` → `client-dist`
- **Server dist**: `packages/server/dist` → `server-dist`
- **Harness-headless**: `packages/harness-headless/dist` → `harness-headless-dist`
- **Rust binaries**: `target/release/*` → `rust-binaries`

Artifacts are retained for 30 days.

## Caching

The workflow uses caching to speed up builds:

1. **Node.js cache**: `actions/setup-node@v4` with `cache: 'npm'`
2. **Rust cache**: `swatinem/rust-cache@v2` for cargo dependencies

## Concurrency Control

The workflow uses concurrency groups to cancel outdated runs:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

This ensures only one CI run per branch is active at a time.

## Permissions

The workflow requires:

```yaml
permissions:
  contents: read
  pull-requests: write
```

- `contents: read` - Checkout code
- `pull-requests: write` - Post PR comments for coverage

## Running CI Locally

### Type Check
```bash
npm run build --workspace=packages/client -- --noEmit
npm run build --workspace=packages/server -- --noEmit
```

### Linting
```bash
cargo fmt -- --check
cargo clippy --workspace -- -D warnings
```

### Tests
```bash
npm run test --workspace=packages/client
npm run test --workspace=packages/server
cargo test --workspace
```

### Coverage
```bash
NODE_ENV=test c8 npm run test --workspace=packages/client
cargo tarpaulin --workspace --out Xml
```

## Troubleshooting

### Coverage Not Uploading

1. Check Codecov token in repository secrets (`CODECOV_TOKEN`)
2. Verify `fail_ci_if_error: false` is set
3. Check coverage file paths in workflow

### Build Failing

1. Check if dependencies are up to date
2. Verify Rust toolchain version matches workflow
3. Check Node.js version (workflow uses Node 20)

### Tests Failing in CI but Passing Locally

1. Check environment variables (CI sets `NODE_ENV=test`)
2. Verify all dependencies are installed via `npm ci`
3. Check for platform-specific issues (CI runs on Ubuntu)

## Adding New Tests

1. Add test files following existing patterns (`*.test.ts` or `*.test.tsx`)
2. Add test paths to the test command in `package.json`
3. Update `.c8rc.json` to exclude new test files if needed
4. Run tests locally to verify they pass

## Updating Dependencies

When updating dependencies:

1. Update `package.json` or `Cargo.toml`
2. Run tests locally
3. Push changes - CI will verify compatibility
4. Check for deprecation warnings in CI output

## Future Enhancements

Potential improvements:

1. Add lint/staging workflow for PR comments
2. Add performance benchmarking job
3. Add integration tests for end-to-end scenarios
4. Add automated changelog generation
5. Add release workflow for GitHub releases
