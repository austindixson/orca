# Branch Protection Rules for OrcaCoder Repository

## Main Branch Protection

### Required Rules for `main` branch

1. **Require pull request reviews before merging**
   - Minimum of 1 approving review
   - Dismiss stale reviews when new commits are pushed
   - Require review from CODEOWNERS

2. **Require status checks to pass before merging**
   - All CI/CD checks must pass
   - Required checks:
     - `ci / build-client`
     - `ci / build-server`
     - `ci / test-client`
     - `ci / lint`

3. **Require branches to be up to date before merging**
   - Branch must be updated with the base branch before merging
   - Prevents merging outdated code

4. **Restrict who can push to matching branches**
   - Only allow administrators to push directly to `main`
   - All changes must go through pull requests

5. **Block force pushes**
   - Prevent force pushes to `main`
   - Maintain commit history integrity

6. **Require linear history**
   - Ensure merge commits follow a clean linear history
   - Prefer rebase and squash merge strategies

## Development Branches

### Feature Branches
- Prefix: `feat/`
- Example: `feat/inspect-module`
- No protection rules
- Delete after merge

### Bugfix Branches
- Prefix: `fix/`
- Example: `fix/network-capture`
- No protection rules
- Delete after merge

### Documentation Branches
- Prefix: `docs/`
- Example: `docs/api-reference`
- No protection rules
- Delete after merge

### Hotfix Branches
- Prefix: `hotfix/`
- Example: `hotfix/critical-security`
- Higher priority in CI queue
- Require 2 approving reviews for hotfixes
- Delete after merge

## Pull Request Requirements

1. **All PRs must:**
   - Have a descriptive title following Conventional Commits
   - Include a description of changes
   - Reference related issues
   - Pass all CI checks
   - Have at least 1 approving review

2. **Conventional Commit Types:**
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting, etc.)
   - `refactor:` Code refactoring
   - `test:` Adding or updating tests
   - `chore:` Maintenance tasks

3. **PR Labels (Required):**
   - `type:feature`
   - `type:bugfix`
   - `type:documentation`
   - `type:refactor`
   - `type:testing`
   - `type:maintenance`
   - `priority:critical`
   - `priority:high`
   - `priority:medium`
   - `priority:low`

## CODEOWNERS Integration

The CODEOWNERS file defines who must approve changes to specific paths:

- Core infrastructure changes require approval from maintainers
- Documentation changes can be approved by any team member
- Security-related changes require approval from security team

## Implementation Steps

To implement these rules in GitHub:

1. Go to **Settings** > **Branches** > **Branch protection rules**
2. Click **Add rule** and select `main` branch
3. Configure the settings as described above
4. Add CODEOWNERS requirement
5. Save the rule

## Enforcement

- GitHub will automatically enforce these rules
- Bypassing protection requires explicit approval from repository admins
- All bypass actions are logged for audit purposes

## Regular Review

These protection rules should be reviewed:
- Quarterly for effectiveness
- When team structure changes
- When workflow processes are updated
- After major incidents or security events

## Related Documentation

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [CODEOWNERS File](.github/CODEOWNERS)
- [Conventional Commits](https://www.conventionalcommits.org/)
