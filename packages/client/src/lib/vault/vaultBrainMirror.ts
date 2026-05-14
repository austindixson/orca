/**
 * Optional writes to workspace `Orca/brain/**` for errors, session stubs, telemetry.
 * Gated by Settings; never throws to callers.
 */

import * as tauri from '../tauri'
import { isCanvasPersistenceHydrating } from '../canvasStatePersistence'
import { useSettingsStore } from '../../store/settingsStore'
import { useMemPalaceStore } from '../../store/memPalaceStore'
import {
  recordVaultMirrorSuccess,
  reportVaultMirrorFailure,
} from '../../store/vaultMirrorDiagnosticsStore'

const ERR_PREFIX = 'Orca/brain/errors'
const SESS_PREFIX = 'Orca/brain/sessions'
const TELEM_PREFIX = 'Orca/brain/telemetry'
const SELF_TEST_REL = 'Orca/brain/debug/self-test.md'

/** Redact common secret patterns (no length cap — use for long transcripts). */
export function applyVaultSecretRedaction(s: string): string {
  let t = s
  t = t.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[redacted]')
  t = t.replace(/\bBearer\s+[a-zA-Z0-9._-]{20,}\b/gi, 'Bearer [redacted]')
  t = t.replace(/\b(api[_-]?key|apikey|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  return t
}

/** Short mirror snippets (errors, stubs). */
export function scrubVaultMirrorText(s: string): string {
  return applyVaultSecretRedaction(s).slice(0, 8000)
}

export async function ensureDirForWorkspaceRelativeFile(relativePath: string): Promise<void> {
  const norm = relativePath.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  if (i <= 0) return
  const dir = norm.slice(0, i)
  await tauri.createDirectory(dir)
}

function scheduleBrainScan(): void {
  const t = (globalThis as unknown as { __orcaBrainScanTimer?: ReturnType<typeof setTimeout> })
    .__orcaBrainScanTimer
  if (t) clearTimeout(t)
  ;(globalThis as unknown as { __orcaBrainScanTimer?: ReturnType<typeof setTimeout> })
    .__orcaBrainScanTimer = setTimeout(() => {
    void useMemPalaceStore.getState().scan()
  }, 600)
}

/**
 * Whether a workspace-relative markdown path should trigger a MemPalace brain rescan after write.
 * Exported for unit tests (`wiki/`, `orca/**`, `raw/`; case-insensitive).
 */
export function vaultMarkdownPathTriggersBrainScan(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/').toLowerCase()
  if (!norm.endsWith('.md')) return false
  return norm.startsWith('wiki/') || norm.startsWith('orca/') || norm.startsWith('raw/')
}

/**
 * Reschedule Obsidian brain graph scan after markdown writes under wiki/, orca/**, or raw/.
 * `orca/` covers Orca/brain/chat/debug/ and any future Orca/* folders (case-insensitive).
 */
export function maybeScheduleMemPalaceScanAfterMarkdownWrite(relativePath: string): void {
  if (!vaultMarkdownPathTriggersBrainScan(relativePath)) return
  scheduleBrainScan()
}

export function vaultBrainMirrorEnabled(): boolean {
  if (!tauri.isTauri()) return false
  return useSettingsStore.getState().orcaVaultBrainMirrorEnabled === true
}

export async function mirrorOrchestratorErrorToVault(message: string): Promise<void> {
  if (!vaultBrainMirrorEnabled()) return
  if (!useSettingsStore.getState().orcaVaultMirrorErrors) return
  if (isCanvasPersistenceHydrating()) return
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return
    const ts = new Date()
    const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`
    const rel = `${ERR_PREFIX}/${stamp}.md`
    await ensureDirForWorkspaceRelativeFile(rel)
    const body = `---
kind: Orca error mirror
created: ${ts.toISOString()}
---

${scrubVaultMirrorText(message)}
`
    await tauri.writeFile(rel, body)
    recordVaultMirrorSuccess('error', rel)
    void import('./centralBrainMirror').then((m) => m.mirrorWorkspaceFileToCentral(rel, body))
    scheduleBrainScan()
  } catch (e) {
    reportVaultMirrorFailure('error', `${ERR_PREFIX}/…`, e)
  }
}

export async function mirrorOrchestratorSessionToVault(assistantPreview: string): Promise<void> {
  if (!vaultBrainMirrorEnabled()) return
  if (!useSettingsStore.getState().orcaVaultMirrorSessions) return
  if (isCanvasPersistenceHydrating()) return
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return
    const ts = new Date()
    const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`
    const rel = `${SESS_PREFIX}/${stamp}.md`
    await ensureDirForWorkspaceRelativeFile(rel)
    const preview = scrubVaultMirrorText(assistantPreview.trim()).slice(0, 4000)
    const body = `---
kind: Orca session stub
created: ${ts.toISOString()}
---

${preview || '(empty)'}
`
    await tauri.writeFile(rel, body)
    recordVaultMirrorSuccess('session', rel)
    void import('./centralBrainMirror').then((m) => m.mirrorWorkspaceFileToCentral(rel, body))
    scheduleBrainScan()
  } catch (e) {
    reportVaultMirrorFailure('session', `${SESS_PREFIX}/…`, e)
  }
}

/** Weekly rollup stub — call sparingly (e.g. once per app session when telemetry enabled). */
export async function mirrorTelemetryRollupToVault(summaryMarkdown: string): Promise<void> {
  if (!vaultBrainMirrorEnabled()) return
  if (!useSettingsStore.getState().orcaVaultMirrorTelemetry) return
  if (isCanvasPersistenceHydrating()) return
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') return
    const d = new Date()
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const rel = `${TELEM_PREFIX}/rollup-${month}.md`
    await ensureDirForWorkspaceRelativeFile(rel)
    const body = scrubVaultMirrorText(summaryMarkdown)
    await tauri.writeFile(rel, body)
    recordVaultMirrorSuccess('telemetry', rel)
    void import('./centralBrainMirror').then((m) => m.mirrorWorkspaceFileToCentral(rel, body))
    scheduleBrainScan()
  } catch (e) {
    reportVaultMirrorFailure('telemetry', `${TELEM_PREFIX}/…`, e)
  }
}

/**
 * Diagnostic write: creates `Orca/brain/debug/self-test.md` and rescans the brain graph.
 * Does not require `vaultBrainMirrorEnabled` — use to verify Tauri + workspace + permissions.
 */
export async function forceVaultMirrorSelfTest(): Promise<{
  ok: boolean
  relPath?: string
  error?: string
}> {
  const rel = SELF_TEST_REL
  if (!tauri.isTauri()) {
    return { ok: false, relPath: rel, error: 'Not running in Tauri desktop.' }
  }
  try {
    const ws = await tauri.getWorkspace()
    if (!ws?.path || ws.path === '.') {
      return { ok: false, relPath: rel, error: 'No workspace open or placeholder workspace path.' }
    }
    await ensureDirForWorkspaceRelativeFile(rel)
    const body = `---
kind: Orca vault mirror self-test
created: ${new Date().toISOString()}
---

OK
`
    await tauri.writeFile(rel, body)
    recordVaultMirrorSuccess('self-test', rel)
    void import('./centralBrainMirror').then((m) => m.mirrorWorkspaceFileToCentral(rel, body))
    scheduleBrainScan()
    return { ok: true, relPath: rel }
  } catch (e) {
    reportVaultMirrorFailure('self-test', rel, e)
    return { ok: false, relPath: rel, error: e instanceof Error ? e.message : String(e) }
  }
}
