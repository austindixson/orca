---
name: setup-stripe
description: Configure Stripe (CLI, webhooks, test/live keys via env names only). Read playbooks/stripe.md first; never write API keys to vault or repo — use .env.local and 1Password references.
---

# Stripe setup (Orca setup skill)

## Before you start

1. Read **`playbooks/stripe.md`** in the central vault for the user’s account, products naming, and webhook URL patterns.
2. Ensure **Stripe CLI** is installed (`stripe --version`) for local webhook forwarding if needed.

## Workflow

1. **Login:** `stripe login` (interactive) — user must complete browser auth; do not capture session tokens into markdown.
2. **Products / prices:** Use Dashboard or CLI to create products; document **price ids** as env var names (e.g. `STRIPE_PRICE_PRO`) in the playbook, not secret values.
3. **Webhooks:** Register endpoint URL (production + local via `stripe listen --forward-to`). Put **signing secret** in `.env.local` with a name like `STRIPE_WEBHOOK_SECRET` — reference the name in the playbook only.
4. **App wiring:** Add server-side Stripe init using **env var names** from `.env.example`; never commit real keys.

## Distill

Append non-secret learnings to `playbooks/stripe.md` (test vs live mode, webhook paths, CLI quirks).

## References

- Stripe CLI: https://stripe.com/docs/stripe-cli
- `docs/CENTRAL_BRAIN.md`
