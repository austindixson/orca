import React from 'react'
import './index.css'
import 'driver.js/dist/driver.css'
import './styles/driver-tooltip.css'

function ttfpEnabled(): boolean {
  return true
}

async function recordTtfp(stage: string): Promise<void> {
  const ts = Date.now()
  console.log('[TTFP]', stage, ts)
  try {
    const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
    if (w.__TAURI__ || w.__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('record_ttfp_marker', { stage, timestampMs: ts }).catch((e) => { console.error('[TTFP] invoke failed', e) })
    }
  } catch {}
}

async function boot() {
  if (ttfpEnabled()) {
    ;(window as unknown as { __TTFP__: Record<string, number>; __recordTtfp?: typeof recordTtfp }).__TTFP__ = {}
    ;(window as unknown as { __recordTtfp?: typeof recordTtfp }).__recordTtfp = recordTtfp
    void recordTtfp('T1_JS_BOOT')
  }
  let label = 'browser'
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        label = (await getCurrentWebviewWindow().label) || 'main'
      } catch {
        label = 'browser'
      }
    }
    ;(window as unknown as { __AC_WINDOW_LABEL__: string }).__AC_WINDOW_LABEL__ = label
  }

  const [{ default: App }, ReactDOM] = await Promise.all([import('./App'), import('react-dom/client')])

  await import('./lib/test-backend')
  await import('./lib/test-frontend')

  const { installUnifiedTelemetry } = await import('./lib/telemetry/installGlobalErrorCapture')
  installUnifiedTelemetry()

  // Wire best-effort team-chat JSONL mirror → `Orca/chat/team/<sessionId>.jsonl`.
  const { registerGroupChatVaultMirror } = await import('./lib/vault/groupChatVaultMirror')
  registerGroupChatVaultMirror()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
