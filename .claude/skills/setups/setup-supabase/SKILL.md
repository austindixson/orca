---
name: setup-supabase
description: Create or link a Supabase project (CLI, migrations, RLS checklist). Read playbooks/supabase.md first; store only connection **variable names** in notes, not service_role keys.
---

# Supabase setup (Orca setup skill)

## Before you start

1. Read **`playbooks/supabase.md`** for org, region preference, and naming.
2. Confirm **Supabase CLI** (`supabase --version`) and logged-in state (`supabase projects list`).

## Workflow

1. **Project:** `supabase init` in repo if needed; link with `supabase link --project-ref <ref>` when the user provides the ref.
2. **Schema:** Apply migrations from `supabase/migrations/`; run `supabase db push` or local `supabase start` for dev as appropriate.
3. **RLS:** Enable RLS on user-facing tables; document policies in repo migrations, not in the playbook.
4. **Env:** Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`; **service_role** only on server — document names in playbook, not values.

## Distill

Update `playbooks/supabase.md` with region, auth providers enabled, and migration pitfalls (no secrets).

## References

- Supabase CLI: https://supabase.com/docs/guides/cli
- `docs/CENTRAL_BRAIN.md`
