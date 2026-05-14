# Pre-commit Hooks Setup

This project uses [pre-commit](https://pre-commit.com/) to maintain code quality and consistency.

## Installation

1. **Install pre-commit** (choose one):
   ```bash
   # Using pip (recommended)
   pip install pre-commit

   # Using Homebrew (macOS)
   brew install pre-commit

   # Using conda
   conda install -c conda-forge pre-commit
   ```

2. **Install the git hooks**:
   ```bash
   pre-commit install
   ```

3. **Run hooks on all files** (first time setup):
   ```bash
   pre-commit run --all-files
   ```

## How It Works

Pre-commit hooks run automatically when you commit changes. They:
- Format code with Prettier (TypeScript/JavaScript/JSON/YAML/Markdown)
- Format Rust code with `cargo fmt`
- Check Rust code with `cargo clippy`
- Fix trailing whitespace and line endings
- Validate YAML, JSON, and TOML files
- Detect accidental private key commits

## Skipping Hooks (Not Recommended)

If you need to skip hooks for a specific commit:
```bash
git commit --no-verify -m "Your message"
```

## Updating Hooks

Periodically update hook versions:
```bash
pre-commit autoupdate
pre-commit run --all-files
```

## Troubleshooting

If hooks fail:
1. Read the error message carefully
2. Fix the issues automatically if possible (e.g., formatting)
3. Run the hook manually to verify: `pre-commit run <hook-id> --all-files`
