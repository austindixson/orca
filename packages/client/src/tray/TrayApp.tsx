import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

type OrcaBridgeConfig = {
  base_url: string
  token: string | null
}

type HealthJson = {
  status?: string
  headlessGatewayRegistered?: boolean
}

type GatewayStatusJson = {
  telegram?: { running?: boolean }
  uiClients?: number
  headlessGatewayRegistered?: boolean
}

const TILES = ['Orchestrator', 'Gateway & settings'] as const

function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token && token.trim()) {
    h.Authorization = `Bearer ${token.trim()}`
  }
  return h
}

export function TrayApp() {
  const [cfg, setCfg] = useState<OrcaBridgeConfig | null>(null)
  const [tile, setTile] = useState(0)
  const [health, setHealth] = useState<HealthJson | null>(null)
  const [gw, setGw] = useState<GatewayStatusJson | null>(null)
  const [gwBusy, setGwBusy] = useState(false)
  const [gwMsg, setGwMsg] = useState<string | null>(null)

  const [orchInput, setOrchInput] = useState('')
  const [orchLog, setOrchLog] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [orchBusy, setOrchBusy] = useState(false)

  const loadCfg = useCallback(async () => {
    try {
      const c = await invoke<OrcaBridgeConfig>('read_orca_bridge_config')
      setCfg(c)
    } catch (e) {
      setCfg({ base_url: 'http://127.0.0.1:3001', token: null })
      setGwMsg(String(e))
    }
  }, [])

  const probe = useCallback(async () => {
    if (!cfg) return
    try {
      const r = await fetch(`${cfg.base_url}/api/health`, { method: 'GET' })
      if (r.ok) {
        setHealth((await r.json()) as HealthJson)
      } else {
        setHealth(null)
      }
    } catch {
      setHealth(null)
    }
    try {
      const r = await fetch(`${cfg.base_url}/api/gateway/status`, {
        headers: authHeaders(cfg.token),
      })
      if (r.ok) {
        setGw((await r.json()) as GatewayStatusJson)
      } else {
        setGw(null)
      }
    } catch {
      setGw(null)
    }
  }, [cfg])

  useEffect(() => {
    void loadCfg()
  }, [loadCfg])

  useEffect(() => {
    if (!cfg) return
    void probe()
    const id = window.setInterval(() => void probe(), 4000)
    return () => window.clearInterval(id)
  }, [cfg, probe])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '[') {
          e.preventDefault()
          setTile((t) => (t + TILES.length - 1) % TILES.length)
        }
        if (e.key === ']') {
          e.preventDefault()
          setTile((t) => (t + 1) % TILES.length)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const daemonUp = health?.status === 'ok'
  const base = cfg?.base_url ?? '…'

  const sendOrchestrator = async () => {
    const text = orchInput.trim()
    if (!text || !cfg) return
    setOrchBusy(true)
    setOrchInput('')
    setOrchLog((prev) => [...prev, { role: 'user', text }])
    try {
      const r = await fetch(`${cfg.base_url}/api/harness/chat`, {
        method: 'POST',
        headers: authHeaders(cfg.token),
        body: JSON.stringify({ text }),
      })
      const body = (await r.json()) as { ok?: boolean; reply?: string; error?: string }
      const reply =
        body.reply ??
        (body.error ? `Error: ${body.error}` : `HTTP ${r.status}`)
      setOrchLog((prev) => [...prev, { role: 'assistant', text: reply }])
    } catch (e) {
      setOrchLog((prev) => [
        ...prev,
        { role: 'assistant', text: `Request failed: ${String(e)}` },
      ])
    } finally {
      setOrchBusy(false)
    }
  }

  const gatewayAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!cfg) return
    setGwBusy(true)
    setGwMsg(null)
    try {
      if (action === 'restart' || action === 'stop') {
        const r = await fetch(`${cfg.base_url}/api/gateway/telegram/stop`, {
          method: 'POST',
          headers: authHeaders(cfg.token),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setGwMsg(`Stop failed: ${JSON.stringify(j)}`)
          setGwBusy(false)
          return
        }
      }
      if (action === 'start' || action === 'restart') {
        const r = await fetch(`${cfg.base_url}/api/gateway/telegram/start`, {
          method: 'POST',
          headers: authHeaders(cfg.token),
          body: JSON.stringify({ token: '' }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setGwMsg(`Start failed: ${JSON.stringify(j)}`)
        } else {
          setGwMsg(
            (j as { message?: string }).message ??
              (action === 'restart' ? 'Gateway restarted.' : 'Gateway start requested.'),
          )
        }
      } else {
        setGwMsg('Telegram gateway stopped.')
      }
      await probe()
    } catch (e) {
      setGwMsg(String(e))
    } finally {
      setGwBusy(false)
    }
  }

  const nextTile = () => setTile((t) => (t + 1) % TILES.length)
  const prevTile = () => setTile((t) => (t + TILES.length - 1) % TILES.length)

  const title = useMemo(() => TILES[tile], [tile])

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas-bg text-white/90">
      <header className="flex shrink-0 items-center gap-2 border-b border-tile-border bg-tile-header/95 px-3 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={prevTile}
          className="rounded-md border border-tile-border px-2 py-1 text-xs text-white/70 hover:bg-tile-hover"
          data-tooltip="Previous tile (⌘[)"
        >
          ◀
        </button>
        <div className="min-w-0 flex-1 text-center font-semibold text-accent-teal">{title}</div>
        <button
          type="button"
          onClick={nextTile}
          className="rounded-md border border-tile-border px-2 py-1 text-xs text-white/70 hover:bg-tile-hover"
          data-tooltip="Next tile (⌘])"
        >
          ▶
        </button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-tile-border/80 px-3 py-1.5 text-[11px] text-white/55">
        <span className="truncate font-mono">{base}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
            daemonUp ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
          }`}
        >
          {daemonUp ? 'daemon' : 'offline'}
        </span>
      </div>

      {tile === 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <p className="text-[11px] leading-snug text-white/50">
            Messages go through the headless harness (same as <code className="text-white/70">orca chat</code>
            ). Requires <code className="text-white/70">orcad</code> + harness.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-tile-border bg-tile-bg p-2 text-[13px] leading-relaxed">
            {orchLog.length === 0 ? (
              <p className="text-white/40">Send a message to the orchestrator…</p>
            ) : (
              orchLog.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={`mb-2 whitespace-pre-wrap ${m.role === 'user' ? 'text-accent-blue' : 'text-white/85'}`}
                >
                  <span className="text-[10px] uppercase text-white/35">{m.role}</span>
                  {'\n'}
                  {m.text}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-tile-border bg-canvas-bg px-2 py-1.5 text-[13px] outline-none ring-accent-teal/30 focus:ring-2"
              placeholder="Message…"
              value={orchInput}
              onChange={(e) => setOrchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendOrchestrator()
                }
              }}
            />
            <button
              type="button"
              disabled={orchBusy}
              onClick={() => void sendOrchestrator()}
              className="shrink-0 rounded-md bg-accent-teal/90 px-3 py-1.5 text-[13px] font-medium text-canvas-bg disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {tile === 1 && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-[13px]">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Native gateway (Telegram)
            </h3>
            <div className="space-y-1 rounded-md border border-tile-border bg-tile-bg p-2 text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="text-white/50">Telegram poll</span>
                <span className={gw?.telegram?.running ? 'text-emerald-400' : 'text-white/40'}>
                  {gw?.telegram?.running ? 'running' : 'stopped'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/50">UI WS clients</span>
                <span>{gw?.uiClients ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/50">Headless harness</span>
                <span className={gw?.headlessGatewayRegistered ? 'text-emerald-400' : 'text-amber-400'}>
                  {gw?.headlessGatewayRegistered ? 'registered' : 'not registered'}
                </span>
              </div>
            </div>
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={gwBusy || !daemonUp}
              onClick={() => void gatewayAction('start')}
              className="rounded-md border border-tile-border bg-white/5 px-3 py-1.5 text-[12px] hover:bg-white/10 disabled:opacity-40"
            >
              Start gateway
            </button>
            <button
              type="button"
              disabled={gwBusy || !daemonUp}
              onClick={() => void gatewayAction('stop')}
              className="rounded-md border border-tile-border bg-white/5 px-3 py-1.5 text-[12px] hover:bg-white/10 disabled:opacity-40"
            >
              Stop
            </button>
            <button
              type="button"
              disabled={gwBusy || !daemonUp}
              onClick={() => void gatewayAction('restart')}
              className="rounded-md border border-orange-500/40 bg-orange-500/15 px-3 py-1.5 text-[12px] text-orange-200 hover:bg-orange-500/25 disabled:opacity-40"
            >
              Force restart
            </button>
          </section>

          {gwMsg && <p className="text-[12px] text-white/60">{gwMsg}</p>}

          <p className="text-[11px] leading-relaxed text-white/45">
            Start uses <code className="text-white/60">ORCA_TELEGRAM_BOT_TOKEN</code> on the server or a token
            from Orca settings. Configure the daemon env in your LaunchAgent plist if needed.
          </p>

          <section className="mt-auto flex flex-wrap gap-2 border-t border-tile-border pt-3">
            <button
              type="button"
              onClick={() => void invoke('focus_orca_main_window')}
              className="rounded-md bg-accent-purple/25 px-3 py-1.5 text-[12px] text-accent-purple hover:bg-accent-purple/35"
            >
              Open Orca Coder
            </button>
            <button
              type="button"
              onClick={() => void invoke('hide_tray_panel_window')}
              className="rounded-md border border-tile-border px-3 py-1.5 text-[12px] text-white/70 hover:bg-tile-hover"
            >
              Close panel
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
