# Curated GitHub skill sources (integration ↔ SKILL.md research)

**In Orca:** open **Integrations…** → **Skill sources** (same content, bundled at build time).

This document satisfies the **“tile → skill repo”** matrix that a one-line “based on GitHub Claude skills” claim does not. It is a **targeted pass**: GitHub search for `SKILL.md` + product keywords (Notion, Slack, Gmail, CalDAV, X API, etc.), then curation for **license**, **rough maintenance**, and **fit for Orca**.

## How to read “fit for Orca”

| Fit | Meaning |
|-----|---------|
| **Browser-first** | The integration wizard’s default is a **browser tile** (`meta.url`). Skills matter for *how the agent reasons* while the user works in the web UI; few skills automate the DOM. |
| **API / automation** | Skills that assume **OAuth tokens**, **REST/MCP**, or **local CLIs** — align with orchestrator/tooling, not the iframe. |
| **macOS / local only** | Apple Notes–style skills often need **AppleScript**, **JXA**, or a **memo** CLI on the Mac; irrelevant inside pure web Orca unless you run agents on the same machine. |

**Placement**

- **`docs/skills/integrations/*.md` (in-repo)** — Orca’s **first-party wizard copy**: setup, limits (iframe, CalDAV), and links. We **do not** vendor upstream `SKILL.md` bodies here; we summarize and point to repos.
- **External-only (this table)** — Community or third-party skill repos you install under `~/.claude/skills/` (or your agent’s skill path). Treat licenses as **your** compliance responsibility before redistributing or mirroring.

---

## Matrix (wizard integration → curated repos)

Maintenance is a **subjective** label from public signals (stars, recency, org backing): **strong** / **moderate** / **unknown**.

| Orca integration | Curated repos (examples) | License (verify at repo) | Maintenance | Fit for Orca | In-repo wizard doc | External-only skill? |
|------------------|---------------------------|---------------------------|---------------|--------------|---------------------|----------------------|
| **gmail** | [odyssey4me/agent-skills](https://github.com/odyssey4me/agent-skills) (`skills/gmail`) | Apache-2.0 (repo) | moderate | **API** (OAuth, Gmail API) | [gmail.md](gmail.md) | yes — install skill upstream |
| **gmail** | [googleworkspace/cli](https://github.com/googleworkspace/cli) (docs mention Workspace-oriented skills) | varies by component | strong (Google) | **API** / CLI | [gmail.md](gmail.md) | yes |
| **word-processor** | [robtaylor/google-docs-skill](https://github.com/robtaylor/google-docs-skill), [danielkwapien/google-docs-skill](https://github.com/danielkwapien/google-docs-skill) (fork) | check repo | moderate | **API** (Docs/Drive); browser tile is Docs web | [word-processor.md](word-processor.md) | yes |
| **word-processor** | [anthropics/skills](https://github.com/anthropics/skills) (document skills — reference for docx/pdf pipelines) | Apache-2.0 / source-available mix | strong | **API** / batch docs | [word-processor.md](word-processor.md) | yes (official examples) |
| **twitter** | [jarrodwatts/x-api-skill](https://github.com/jarrodwatts/x-api-skill) | check repo | moderate | **API** (X API) | [twitter.md](twitter.md) | yes |
| **twitter** | [notque/claude-code-toolkit](https://github.com/notque/claude-code-toolkit) (`skills/x-api`) | check repo | unknown | **API** | [twitter.md](twitter.md) | yes |
| **slack** | [tsenart/slack-api-skill](https://github.com/tsenart/slack-api-skill) | check repo | moderate | **API** (Slack Web API) | [slack.md](slack.md) | yes |
| **slack** | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) (e.g. Slack-related samples) | check repo | moderate (curated list) | **API** / MCP patterns | [slack.md](slack.md) | yes |
| **answer-overflow** | No dedicated **Answer Overflow** `SKILL.md` found in a quick pass; discovery is **web/search**. For Discord-oriented automation, search “Discord SKILL.md agent skills” separately. | — | — | **Browser-first** + generic research | [answer-overflow.md](answer-overflow.md) | n/a (use web + browser tile) |
| **caldav** | [openclaw/skills](https://github.com/openclaw/skills) (e.g. CalDAV / iCloud CalDAV / scheduling skills under `skills/`) | check per skill | moderate (aggregator) | **API** / CalDAV / local sync | [caldav.md](caldav.md) | yes |
| **caldav** | [odyssey4me/agent-skills](https://github.com/odyssey4me/agent-skills) (`skills/google-calendar`) | Apache-2.0 | moderate | **API** (Google Calendar; not pure CalDAV) | [caldav.md](caldav.md) | yes |
| **notes** | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (`skills/apple/apple-notes`) | check repo | strong (org) | **macOS / local** | [notes.md](notes.md) | yes |
| **notes** | [openclaw/skills](https://github.com/openclaw/skills) — `mac-notes-agent` and related | check per skill | moderate | **macOS / local** | [notes.md](notes.md) | yes |
| **reminders** | No first-class **Apple Reminders** skill stood out in the same pass; Orca steers to **Todo tile**. CalDAV/ICS skills *may* overlap for some providers — validate against your host. | — | — | **Todo / system** | [reminders.md](reminders.md) | external skills TBD |
| **google-drive** | [astoreyai/claude-skills](https://github.com/astoreyai/claude-skills) (`skills/google/google-drive-management`) | check repo | unknown | **API** (Drive API) | [google-drive.md](google-drive.md) | yes |
| **nano-banana-pro** | **n/a** — placeholder until a canonical product URL + any public `SKILL.md` exist. | — | — | **custom** | [nano-banana-pro.md](nano-banana-pro.md) | **n/a** (update when shipped) |
| **obsidian** | [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) | MIT | strong | **Vault / files** + CLI; pairs with editor tools | [obsidian.md](obsidian.md) | yes — **primary** Obsidian skill set |
| **obsidian-brain** | Same as Obsidian; Orca adds **sidebar graph** (app feature). Skills still [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) + [json-canvas](https://github.com/kepano/obsidian-skills) where relevant | MIT | strong | **Browser-first** (sidebar) + vault | [obsidian-brain.md](obsidian-brain.md) | yes |
| **notion** | [mattppal/formatting-notion-pages](https://github.com/mattppal/formatting-notion-pages) — Notion API blocks / rich text / page structure | check repo | unknown | **API** (Notion API); [notion.md](notion.md) details pairing | [notion.md](notion.md) | yes |
| **notion** | [anthropics/skills](https://github.com/anthropics/skills) — **spec/reference** for Agent Skills; combine with Notion MCP or HTTP | Apache-2.0 / mixed | strong | **Reference** + tooling | [notion.md](notion.md) | official reference |
| **prismfy** | **n/a** — placeholder until team URL + optional public skill. | — | — | **custom** | [prismfy.md](prismfy.md) | **n/a** |
| **apigateway** | **No single AWS API Gateway `SKILL.md`** in this pass. Use **browser tile** → consoles/docs; add **MCP** / **OpenAPI**-driven skills from [anthropics/skills](https://github.com/anthropics/skills) or community servers ad hoc. | mixed | strong | **Browser-first** + infra / OpenAPI | [apigateway.md](apigateway.md) | patterns only |

---

## Official reference

| Resource | Role |
|----------|------|
| [anthropics/skills](https://github.com/anthropics/skills) | Anthropic’s public Agent Skills; Apache-2.0 for many skills; some document skills are source-available — read each folder’s `LICENSE`. |

---

## Maintenance of this doc

Re-run a **GitHub code search** periodically (`SKILL.md` + product name) — repos churn. Prefer **pinning a commit** or **release tag** when you recommend a skill in user-facing runbooks.
