# Prismfy search (custom)

## Status: **n/a — placeholder**

| Item | State |
|------|--------|
| **Default URL** | None — team-specific search hub |
| **Curated GitHub `SKILL.md`** | **None** in [CURATED_SKILL_SOURCES.md](CURATED_SKILL_SOURCES.md) until Prismfy (or your chosen hub) publishes a linkable skill or API doc |
| **Skill matrix row** | Explicit **n/a** — fill in when URLs and licenses are known |

## In the wizard

1. Paste your **Prismfy** or team **search-hub** URL (full `https://…`).
2. **Add browser tile** or **Open in default browser** if embedding fails.

## After you standardize on one URL

Set `defaultUrl` in `packages/client/src/lib/integrations/integrationCatalog.ts` for one-click defaults for the team, and add curated skill sources if any public `SKILL.md` appears.
