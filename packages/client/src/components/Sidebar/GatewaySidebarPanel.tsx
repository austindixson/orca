import { useState } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { TelegramGatewayControls } from '../Telegram/TelegramGatewayControls'
import {
  TelegramOnboardNumberedSteps,
  TelegramOnboardQrBlock,
  TelegramOnboardTroubleshooting,
} from '../Telegram/TelegramOnboardShared'

/**
 * Left sidebar: Telegram native gateway health, token, and start/stop/restart without opening Settings.
 * QR + numbered steps mirror the canvas onboard tile until the gateway has been started successfully once.
 */
export function GatewaySidebarPanel() {
  const setupComplete = useSettingsStore((s) => s.orcaTelegramGatewayStartKnown)
  const [showChecklistAgain, setShowChecklistAgain] = useState(false)

  const showFirstTimeBlock = !setupComplete || showChecklistAgain

  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="shrink-0 border-b border-tile-border/80 px-4 py-2">
        <div className="text-xs uppercase tracking-wider text-gray-400">Integrations</div>
        <div className="mt-0.5 text-sm font-semibold text-gray-100">Telegram gateway</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-3 text-[11px] leading-relaxed text-gray-500">
          Needs the Orca companion on this machine (default{' '}
          <code className="rounded bg-black/35 px-1 font-mono text-[10px]">:3001</code>). Messages flow: Telegram →
          companion → WebSocket → this window → orchestrator. Flow works when the gateway is{' '}
          <strong className="text-gray-400">running</strong> and this UI is connected (
          <code className="rounded bg-black/35 px-1 font-mono text-[10px]">uiClients ≥ 1</code>).
        </p>
        <TelegramGatewayControls compact />

        {showFirstTimeBlock ? (
          <div className="mt-4 space-y-3 border-t border-tile-border/60 pt-4">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">First-time (do once)</p>
            <p className="text-[11px] leading-snug text-gray-400">
              <strong className="text-gray-300">Paste token</strong> → <strong className="text-gray-300">Start</strong> →
              keep this window open → message your bot in Telegram.
            </p>
            <TelegramOnboardQrBlock
              compact
              className="flex flex-col items-center gap-2 rounded-lg border border-tile-border/70 bg-black/25 px-2 py-2.5"
            />
            <TelegramOnboardNumberedSteps compact />
            <TelegramOnboardTroubleshooting compact />
            {setupComplete && showChecklistAgain && (
              <button
                type="button"
                onClick={() => setShowChecklistAgain(false)}
                className="text-[10px] text-gray-500 underline decoration-gray-600 underline-offset-2 hover:text-gray-300"
              >
                Hide setup checklist
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2 border-t border-tile-border/60 pt-4">
            <p className="text-[10px] leading-relaxed text-gray-500">
              First-time setup is done on this machine. Use <strong className="text-gray-400">Start/Stop</strong> above,
              or the Telegram button in the center toolbar (one-click start when credentials are saved). Add the{' '}
              <strong className="text-gray-400">Telegram onboard</strong> canvas tile for the full visual guide.
            </p>
            <button
              type="button"
              onClick={() => setShowChecklistAgain(true)}
              className="text-left text-[11px] font-medium text-accent-teal/90 hover:text-accent-teal"
            >
              Show setup checklist again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
