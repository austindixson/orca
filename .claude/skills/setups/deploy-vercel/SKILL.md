---
name: deploy-vercel
description: Deploy a web app to Vercel (CLI, Git link, env vars, domains). Read the central vault playbook first, then execute; distill learnings back to playbooks/vercel.md (no secrets).
---

# Deploy to Vercel (Orca setup skill)

## Before you start

1. **Read** the user’s central vault `playbooks/vercel.md` (via `read_file` on that path if the workspace is the vault, or ask the user to paste it). Use it for team id, default project naming, and DNS quirks — **never** paste API tokens into chat or brain files.
2. Confirm **Node** / **pnpm or npm** and that `vercel` CLI is available (`npx vercel --version`).

## Workflow

1. **Link / deploy:** From the project root, run `vercel` or `vercel --prod` as appropriate; use non-interactive flags when possible (`--yes`). Prefer linking to the existing Git repo if the user uses GitHub/GitLab integration.
2. **Environment variables:** Add production/preview secrets via `vercel env add` or the dashboard — do not commit `.env` with real secrets; document **names only** in the playbook learnings section.
3. **Domain:** If the user owns a domain, attach it in the Vercel project settings or `vercel domains`; DNS steps belong in `playbooks/domain-dns.md` cross-links.
4. **Verify:** Open the deployment URL (browser tile) and confirm the app loads.

## Distill (after success or partial success)

Append a short bullet list to `playbooks/vercel.md` under `learnings:` (YAML) or as a `## Session notes` section — **redact** any token-like strings. Mention project id, framework (Next, Vite, etc.), and any flags that worked.

## References

- Vercel CLI: https://vercel.com/docs/cli
- `docs/CENTRAL_BRAIN.md` — central vault layout
