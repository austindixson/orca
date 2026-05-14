import {
  fetchCanvasBridgeStatus,
  getCanvasBridgeAuthHeaders,
  getCanvasBridgeHttpOrigin,
} from './canvasBridgeApi'

export type OrcaDoctorLine = { ok: boolean; text: string }

/**
 * Browser-side parity with `scripts/orca-doctor.mjs`: GET health + bridge-status against the companion server.
 */
export async function runOrcaDoctorClient(): Promise<OrcaDoctorLine[]> {
  const base = getCanvasBridgeHttpOrigin()
  const headers = getCanvasBridgeAuthHeaders()
  const lines: OrcaDoctorLine[] = []

  try {
    const r = await fetch(`${base}/api/health`, { headers })
    const body = await r.json().catch(() => ({}))
    lines.push({
      ok: r.ok,
      text: `GET /api/health → ${r.status} ${JSON.stringify(body)}`,
    })
  } catch (e) {
    lines.push({
      ok: false,
      text: `GET /api/health → ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  try {
    const s = await fetchCanvasBridgeStatus()
    lines.push({
      ok: (s.uiClients ?? 0) > 0,
      text: `GET /api/canvas/bridge-status → uiClients: ${s.uiClients} · tokenRequired: ${s.tokenRequired}`,
    })
  } catch (e) {
    lines.push({
      ok: false,
      text: `bridge-status → ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  const tok = import.meta.env.VITE_CANVAS_BRIDGE_TOKEN as string | undefined
  lines.push({
    ok: true,
    text: `VITE_CANVAS_BRIDGE_TOKEN: ${tok?.trim() ? '(set in client env)' : '(unset — localhost dev is usually open)'}`,
  })

  return lines
}
