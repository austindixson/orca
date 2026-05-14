# Central brain (Obsidian + iCloud)

Orca can **dual-write** each workspace’s `Orca/brain/**` and `Orca/chat/**` into a **single central Obsidian vault** (default on macOS: iCloud Drive → `OrcaBrain`). iCloud syncs that folder to your other Macs, iPhone, and iPad; Orca keeps each **project’s** brain in the repo while also maintaining the **union** under `projects/<project-id>/` in the central vault.

## Layout (central vault)

```
OrcaBrain/
  index.md                 # auto-generated project catalog
  playbooks/
    README.md
    vercel.md
    stripe.md
    supabase.md
    domain-dns.md
    github-oauth.md
  projects/
    _index.json
    <uuid>/
      manifest.json
      brain/
      chat/
```

## Settings

**Settings → Agent data → Central brain (iCloud)**

- **Enable central brain** — dual-write mirrors (requires Tauri desktop).
- **Reverse sync** — when iCloud updates files under `projects/<id>/`, apply them into the open workspace.
- **Central vault path** — leave empty for the default iCloud path, or pick any folder (e.g. a dedicated vault).

## Tools

- `search_project_wiki` — searches the workspace wiki + brain, and **also** the central vault when central brain is enabled (`central:…` paths in hits).
- `search_central_playbooks` — searches only `playbooks/**` in the central vault (setup notes, no secrets).

## Playbooks + setup skills

Executable setup flows live under [`docs/skills/setups/`](docs/skills/setups/) (mirrored to `.cursor/skills/setups/` and `.claude/skills/setups/`). Personal account context belongs in `playbooks/<tool>.md` in the central vault (env var **names** and 1Password references only — never raw keys).

## Offline queue

Failed central writes are appended to `~/.orca/central-brain-queue.jsonl` and replayed on the next successful write.
