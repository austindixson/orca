# Linting and Code Quality Tools

This document describes the linting and formatting tools configured for the Orca Coder project.

## Overview

Orca Coder uses a comprehensive set of linting and formatting tools for both Node.js/TypeScript and Rust code:

- **Node.js/TypeScript**: ESLint, Prettier, TypeScript Compiler
- **Rust**: rustfmt, Clippy
- **CI Integration**: GitHub Actions workflows

## Node.js / TypeScript Linting

### ESLint Configuration

The ESLint configuration is in `.eslintrc.js` at the project root.

**Key Features:**
- Extends `eslint:recommended`, `@typescript-eslint/recommended`, `react/recommended`
- React Hooks plugin for React best practices
- JSX accessibility rules (jsx-a11y)
- TypeScript-specific rules for type safety

**Running ESLint:**

```bash
# Run ESLint on all files
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

**ESLint Rules:**
- `@typescript-eslint/no-unused-vars`: Error (with `_` prefix pattern for intentionally unused vars)
- `@typescript-eslint/no-explicit-any`: Warn
- `react/react-in-jsx-scope`: Off (not required for React 17+)
- `react-hooks/rules-of-hooks`: Error
- `react-hooks/exhaustive-deps`: Warn
- `no-console`: Warn (allows warn/error)

**Ignored Paths:**
- `dist`, `build`, `node_modules`, `coverage`, `target`
- `*.config.js`, `*.config.ts`
- `vite.config.ts`

### Prettier Configuration

The Prettier configuration is in `.prettierrc` at the project root.

**Settings:**
- `semi`: true
- `trailingComma`: es5
- `singleQuote`: false
- `printWidth`: 100
- `tabWidth`: 2
- `useTabs`: false
- `arrowParens`: always
- `endOfLine`: lf

**Running Prettier:**

```bash
# Format all files
npm run format

# Check formatting without changing files
npm run format:check
```

**Supported File Types:**
- JavaScript (.js, .jsx)
- TypeScript (.ts, .tsx)
- JSON (.json)
- Markdown (.md)

### TypeScript Type Checking

TypeScript is configured with strict mode enabled in each package's `tsconfig.json`.

**Key Compiler Options:**
- `strict`: true
- `noUnusedLocals`: true
- `noUnusedParameters`: true
- `noFallthroughCasesInSwitch`: true
- `noEmit`: true

**Running Type Check:**

```bash
# Type check all packages
npm run type-check

# Type check specific package
npm run build --workspace=packages/client -- --noEmit
npm run build --workspace=packages/server -- --noEmit
```

## Rust Linting

### rustfmt

rustfmt is the official Rust code formatter.

**Running rustfmt:**

```bash
# Format all Rust code
npm run rust:fmt

# Check formatting without changing files
npm run rust:fmt:check
```

**Configuration:**
- No explicit `rustfmt.toml` file (uses default formatting)
- Integrated into CI pipeline via `.github/workflows/ci.yml`

### Clippy

Clippy is the Rust linter that catches common mistakes and improves code quality.

**Running Clippy:**

```bash
# Run Clippy on all workspace members
npm run rust:clippy

# Equivalent command
cargo clippy --workspace -- -D warnings
```

**Clippy in CI:**
- Fails CI on any warnings (`-D warnings`)
- Runs after formatting checks
- Part of the `lint` job in `.github/workflows/ci.yml`

## Pre-commit Hooks

Pre-commit hooks can be configured to automatically run linting and formatting before commits.

**Example `.husky/pre-commit` hook:**

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run ESLint
npm run lint

# Run Prettier
npm run format:check

# Run rustfmt check
npm run rust:fmt:check

# Run Clippy
npm run rust:clippy
```

**Installing pre-commit hooks:**

```bash
# Install Husky (if not already installed)
npm install husky --save-dev

# Initialize Husky
npx husky install

# Create pre-commit hook
npx husky add .husky/pre-commit "npm run lint && npm run format:check && npm run rust:fmt:check && npm run rust:clippy"
```

## CI/CD Integration

### GitHub Actions Workflow

The `.github/workflows/ci.yml` file includes linting and formatting checks in the `lint` job.

**Lint Job Steps:**
1. Checkout repository
2. Setup Node.js 20
3. Setup Rust stable with rustfmt and clippy
4. Install dependencies
5. Run TypeScript type check (client)
6. Run TypeScript type check (server)
7. Run Rust fmt check
8. Run Rust clippy

**Status:**
- All linting checks must pass before tests run
- Formatting issues block CI
- Warnings in Clippy fail the build

### Coverage and Quality Reports

After linting passes, the CI workflow runs tests and uploads coverage to Codecov:
- Client coverage (React/TypeScript)
- Server coverage (Node/TypeScript)
- Rust coverage (Tauri, daemon, CLI)

## IDE Integration

### VS Code

**Recommended Extensions:**
- **ESLint** - dbaeumer.vscode-eslint
- **Prettier** - esbenp.prettier-vscode
- **rust-analyzer** - rust-lang.rust-analyzer

**VS Code Settings (`.vscode/settings.json`):**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer",
    "editor.formatOnSave": true
  }
}
```

### Cursor / Claude Code

The project includes:
- `.cursor/mcp.json` - Context7 MCP for documentation
- `.claude/skills/` - Reusable agent skills
- `.cursor/skills/` - Cursor-specific skills

Linting is automatically integrated into the development workflow.

## Best Practices

### Before Committing

1. **Run linting:**
   ```bash
   npm run lint
   npm run rust:clippy
   ```

2. **Auto-fix issues:**
   ```bash
   npm run lint:fix
   npm run format
   npm run rust:fmt
   ```

3. **Type check:**
   ```bash
   npm run type-check
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

### Code Style Guidelines

- **Line length**: Max 100 characters (Prettier config)
- **Indentation**: 2 spaces (TypeScript/JavaScript), 4 spaces (Rust default)
- **Semicolons**: Required (TypeScript/JavaScript)
- **Quotes**: Double quotes preferred
- **Trailing commas**: ES5 style

### Troubleshooting

**ESLint fails with "no-unused-vars":**
- Check for variables that are declared but never used
- Prefix intentionally unused variables with `_` (underscore)

**Prettier conflicts with ESLint:**
- Prettier handles formatting
- ESLint handles code quality
- Disable conflicting ESLint rules in `.eslintrc.js`

**Clippy warnings:**
- Review warnings carefully - they often indicate real issues
- Use `#[allow(clippy::...)]` only when absolutely necessary
- Prefer fixing the underlying issue

## Additional Resources

- **ESLint Documentation**: https://eslint.org/
- **Prettier Documentation**: https://prettier.io/
- **rustfmt Documentation**: https://rust-lang.github.io/rustfmt/
- **Clippy Documentation**: https://rust-lang.github.io/clippy/
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/
