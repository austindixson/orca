# Notion

## In Orca (wizard v1)

**Browser tile** → [Notion](https://www.notion.so). Many workspaces set **X-Frame-Options** or CSP so the page is **blank inside the tile**. Use **Open in default browser** for login, OAuth, and daily work.

**Workspace:** Orca does not store Notion tokens. Your vault lives in Notion’s cloud; the tile is a convenience surface.

---

## Curated Agent Skills (external — install under `~/.claude/skills/`)

These are **not** vendored in Orca; verify **license** at each repo before mirroring.

| Repo | Role | Fit |
|------|------|-----|
| [mattppal/formatting-notion-pages](https://github.com/mattppal/formatting-notion-pages) | Patterns and tooling around **Notion API** blocks, rich text, and page structure | **API** — pair with a Notion integration token |
| [anthropics/skills](https://github.com/anthropics/skills) | Official **Agent Skills** spec, examples, and reference implementations (Apache-2.0 for many skills; read per-folder `LICENSE`) | **Reference** — shape skills; combine with Notion MCP or HTTP tools |

Use **anthropics/skills** as the **format and metadata** reference for how `SKILL.md` should read; use **mattppal/formatting-notion-pages** when you need **Notion-flavored** API behavior (blocks, formatting), not generic markdown.

---

## API and MCP (outside the iframe)

- **Notion API:** [developers.notion.com](https://developers.notion.com/) — REST, OAuth, official SDKs. Automation belongs in scripts, MCP servers, or Hermes-style agents, not in the Orca browser tile alone.
- **MCP:** Search for community **Notion MCP** servers if you want Claude Code / Cursor / Orca orchestrator to call Notion with structured tools; keep secrets in env, not in repo.

Orca’s built-in orchestrator can use **read_file** / **write_file** on **exported** Markdown if you sync Notion to disk elsewhere; that path is separate from live Notion API access.
