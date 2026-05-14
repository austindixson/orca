import { TileComponentProps } from '../Canvas/TileRegistry'
import {
  TelegramOnboardNumberedSteps,
  TelegramOnboardQrBlock,
  TelegramOnboardTroubleshooting,
} from '../Telegram/TelegramOnboardShared'

/**
 * Onboarding for **Orca native Telegram** (companion long-poll → WebSocket → orchestrator).
 * Distinct from Hermes bridge — that path is Option B / external LLM loop.
 */
export function TelegramOnboardTile({ data }: TileComponentProps) {
  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] text-[13px] leading-relaxed"
      style={{
        background:
          'linear-gradient(165deg, #071018 0%, #0c1a2e 42%, #060d14 100%)',
        fontFamily: "'Syne', 'IBM Plex Sans', ui-sans-serif, system-ui",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      <div
        className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(255,107,74,0.22) 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%)' }}
      />

      <header className="relative z-[1] border-b border-white/[0.08] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#ff6b4a]/90">
              Native path
            </p>
            <h2 className="mt-0.5 text-base font-bold tracking-tight text-[#e8f4ff]">
              {data.title?.trim() || 'Telegram · Onboard'}
            </h2>
          </div>
          <span
            className="shrink-0 rounded-full border border-[#38bdf8]/25 bg-[#38bdf8]/10 px-2 py-0.5 font-mono text-[10px] text-sky-200/90"
            data-tooltip="Companion Rust server"
          >
            :3001
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400/95">
          Orca’s <strong className="text-slate-200">built-in orchestrator</strong> answers Telegram. Hermes is optional
          — use <span className="font-mono text-slate-500">hermes_bridge</span> only when Hermes runs the tool loop.
        </p>
      </header>

      <div className="relative z-[1] min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <TelegramOnboardQrBlock />

        <TelegramOnboardNumberedSteps />

        <TelegramOnboardTroubleshooting />

        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
          <span className="text-sky-300/80">docs/</span>
          <span className="text-slate-400">CANVAS_AGENT_BRIDGE.md</span>
          <span className="mx-1 text-slate-600">·</span>
          <span className="text-sky-300/80">npm run </span>
          <span className="text-slate-400">bridge:smoke</span>
        </div>
      </div>
    </div>
  )
}
