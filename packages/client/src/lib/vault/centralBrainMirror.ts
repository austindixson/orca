/**
 * Dual-write workspace `Orca/brain/**` + `Orca/chat/**` to the central iCloud Obsidian vault.
 */

import { invoke } from '@tauri-apps/api/core'
import * as tauri from '../tauri'
import { isCanvasPersistenceHydrating } from '../canvasStatePersistence'
import { useSettingsStore } from '../../store/settingsStore'
import { applyVaultSecretRedaction } from './vaultBrainMirror'
import {
  ensureProjectIdentity,
  readProjectIdentity,
  touchProjectLastSync,
  type ProjectIdentity,
} from './projectIdentity'
import { enqueueCentralBrainFailure, replayCentralBrainQueue } from './centralBrainQueue'
import {
  recordCentralBrainSuccess,
  reportCentralBrainFailure,
} from '../../store/centralBrainDiagnosticsStore'

export function centralBrainMirrorEnabled(): boolean {
  if (!tauri.isTauri()) return false
  return useSettingsStore.getState().centralBrainEnabled === true
}

export async function getEffectiveCentralVaultPath(): Promise<string> {
  const s = useSettingsStore.getState().centralBrainVaultPath?.trim()
  if (s) return s
  return invoke<string>('resolve_default_icloud_brain_path')
}

/** Map workspace-relative path to central vault relative path, or null if not mirrored. */
export function workspaceRelToCentralRel(projectId: string, rel: string): string | null {
  const n = rel.replace(/\\/g, '/')
  const mBrain = /^orca\/brain\//i.exec(n)
  if (mBrain) {
    return `projects/${projectId}/brain/${n.slice(mBrain[0].length)}`
  }
  const mChat = /^orca\/chat\//i.exec(n)
  if (mChat) {
    return `projects/${projectId}/chat/${n.slice(mChat[0].length)}`
  }
  return null
}

async function writeCentralUnsafe(vaultRoot: string, relPath: string, content: string): Promise<void> {
  await invoke('central_brain_write_file', {
    vaultRoot,
    relPath,
    content,
  })
}

export async function mirrorWorkspaceFileToCentral(workspaceRel: string, content: string): Promise<void> {
  if (!centralBrainMirrorEnabled()) return
  if (isCanvasPersistenceHydrating()) return
  try {
    const id = await readProjectIdentity()
    if (!id) return
    const centralRel = workspaceRelToCentralRel(id.id, workspaceRel)
    if (!centralRel) return
    const scrubbed = applyVaultSecretRedaction(content)
    const vaultRoot = await getEffectiveCentralVaultPath()
    try {
      await writeCentralUnsafe(vaultRoot, centralRel, scrubbed)
      await touchProjectLastSync()
      await updateCentralProjectManifest(id, vaultRoot)
      await updateCentralProjectIndex(vaultRoot)
      recordCentralBrainSuccess(centralRel)
      await replayCentralBrainQueue(async (vr, rp, c) => {
        await writeCentralUnsafe(vr, rp, c)
      })
    } catch (e) {
      reportCentralBrainFailure(centralRel, e)
      await enqueueCentralBrainFailure({
        vaultRoot,
        relPath: centralRel,
        content: scrubbed,
        ts: new Date().toISOString(),
      })
    }
  } catch (e) {
    reportCentralBrainFailure(workspaceRel, e)
  }
}

type IndexEntry = { id: string; name: string; lastSync?: string }

async function readJsonFile(vaultRoot: string, rel: string): Promise<unknown | null> {
  const raw = await invoke<string | null>('central_brain_read_file', {
    vaultRoot,
    relPath: rel,
  })
  if (raw == null || raw.trim() === '') return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function updateCentralProjectManifest(identity: ProjectIdentity, vaultRoot: string): Promise<void> {
  const ws = await tauri.getWorkspace()
  const manifest = {
    id: identity.id,
    name: identity.name,
    workspacePath: ws?.path && ws.path !== '.' ? ws.path.replace(/\\/g, '/') : undefined,
    lastSync: new Date().toISOString(),
  }
  const rel = `projects/${identity.id}/manifest.json`
  await writeCentralUnsafe(vaultRoot, rel, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function updateCentralProjectIndex(vaultRoot: string): Promise<void> {
  const raw = await readJsonFile(vaultRoot, 'projects/_index.json')
  const base: { projects: IndexEntry[] } =
    raw && typeof raw === 'object' && raw !== null && 'projects' in (raw as object)
      ? (raw as { projects: IndexEntry[] })
      : { projects: [] }
  const list = [...base.projects]
  const identities = await readProjectIdentity()
  if (!identities) return
  const idx = list.findIndex((p) => p.id === identities.id)
  const entry: IndexEntry = {
    id: identities.id,
    name: identities.name,
    lastSync: identities.lastSync ?? new Date().toISOString(),
  }
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  list.sort((a, b) => (b.lastSync ?? '').localeCompare(a.lastSync ?? ''))
  await writeCentralUnsafe(
    vaultRoot,
    'projects/_index.json',
    `${JSON.stringify({ projects: list }, null, 2)}\n`
  )
  const lines = list
    .map((p) => `- **${p.name}** (\`${p.id.slice(0, 8)}…\`) — last sync: ${p.lastSync ?? '—'}`)
    .join('\n')
  const md = `---
kind: Orca central brain index
updated: ${new Date().toISOString()}
---

# Central brain — projects

Auto-generated catalog of projects mirrored from Orca.

${lines || '(no projects yet)'}
`
  await writeCentralUnsafe(vaultRoot, 'index.md', md)
}

const PLAYBOOK_TOOLS = ['vercel', 'stripe', 'supabase', 'domain-dns', 'github-oauth'] as const

function playbookStub(tool: string): string {
  return `---
tool: ${tool}
accounts: []
defaults: {}
gotchas: []
learnings: []
last_used_in: null
---

# ${tool}

Personal notes for **${tool}** setup (teams, default regions, registrar hints). **Do not** paste API keys or tokens — reference 1Password or env var names only.
`
}

/**
 * Seed `playbooks/` and `index` templates when central brain is first used.
 */
export async function ensureCentralPlaybooksSeed(vaultRoot: string): Promise<void> {
  const readme = `---
kind: Orca playbooks
---

# Setup playbooks

These markdown files hold **your** account-specific context for repeatable deploys (Vercel, Stripe, etc.). Executable steps live in repo skills under \`docs/skills/setups/\`.

**Never store secrets here** — only env var names and 1Password item references.
`
  const existing = await invoke<string | null>('central_brain_read_file', {
    vaultRoot,
    relPath: 'playbooks/README.md',
  })
  if (existing == null) {
    await writeCentralUnsafe(vaultRoot, 'playbooks/README.md', readme)
  }
  for (const tool of PLAYBOOK_TOOLS) {
    const rel = `playbooks/${tool}.md`
    const cur = await invoke<string | null>('central_brain_read_file', {
      vaultRoot,
      relPath: rel,
    })
    if (cur == null) {
      await writeCentralUnsafe(vaultRoot, rel, playbookStub(tool))
    }
  }
}

/**
 * Call after enabling central brain or on workspace bootstrap.
 */
export async function bootstrapCentralBrainLayout(): Promise<void> {
  if (!centralBrainMirrorEnabled()) return
  if (!tauri.isTauri()) return
  const vaultRoot = await getEffectiveCentralVaultPath()
  await invoke('central_brain_create_dir', { vaultRoot, relPath: 'projects' })
  await invoke('central_brain_create_dir', { vaultRoot, relPath: 'playbooks' })
  await ensureProjectIdentity()
  await ensureCentralPlaybooksSeed(vaultRoot)
}

/**
 * Self-test: write debug marker under central vault.
 */
export async function forceCentralBrainSelfTest(): Promise<{
  ok: boolean
  relPath?: string
  error?: string
}> {
  const rel = 'debug/self-test.md'
  if (!tauri.isTauri()) {
    return { ok: false, relPath: rel, error: 'Not running in Tauri desktop.' }
  }
  try {
    const vaultRoot = await getEffectiveCentralVaultPath()
    const body = `---
kind: Orca central brain self-test
created: ${new Date().toISOString()}
---

OK
`
    await writeCentralUnsafe(vaultRoot, rel, body)
    recordCentralBrainSuccess(rel)
    return { ok: true, relPath: rel }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    reportCentralBrainFailure(rel, e)
    return { ok: false, relPath: rel, error: msg }
  }
}

/**
 * Map central vault-relative path to workspace-relative path for reverse sync.
 */
export function centralRelToWorkspaceRel(projectId: string, vaultRel: string): string | null {
  const n = vaultRel.replace(/\\/g, '/')
  const prefix = `projects/${projectId}/`
  if (!n.startsWith(prefix)) return null
  const rest = n.slice(prefix.length)
  if (rest.startsWith('brain/')) {
    return `Orca/brain/${rest.slice('brain/'.length)}`
  }
  if (rest.startsWith('chat/')) {
    return `Orca/chat/${rest.slice('chat/'.length)}`
  }
  return null
}
