import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  fetchOrcaGatewayStatus,
  stopOrcaNativeTelegramGateway,
  type OrcaGatewayStatus,
} from '../../lib/canvasBridgeApi'
import { restartOrcaNativeTelegramGateway } from '../../lib/nativeTelegramGatewaySession'
import {
  friendlyTelegramGatewayError,
  startTelegramGatewayFromSavedSettings,
} from '../../lib/telegramGatewayActions'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useToastStore } from '../../store/toastStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToolbarMenuPortal } from '../Toolbar/useToolbarMenuPortal'
import { TelegramGatewayDoctorModal } from './TelegramGatewayDoctorModal'

const POLL_MS = 4000

function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.73 3.36a1.1 1.1 0 0 0-1.13-.17L2.9 10.1c-.77.3-.76 1.4.01 1.68l4.34 1.6 1.68 5.32c.2.63.99.82 1.45.35l2.47-2.5 4.47 3.3c.55.41 1.34.1 1.47-.58l3.16-14.7a1.1 1.1 0 0 0-.22-1.22ZM9.9 15.2l-.6 3.42-1.28-4.05 9.42-6.03L9.9 15.2Z" />
    </svg>
  )
}

function describeToolbarTitle(
  status: OrcaGatewayStatus | null,
  offline: boolean,
  hasSaved: boolean,
  gatewayRunning: boolean
): string {
  if (!hasSaved) {
    return 'Telegram · add credentials in Integrations, or open Gateway sidebar'
  }
  if (offline) {
    return 'Telegram · companion server unreachable — start the bridge on port 3001'
  }
  if (!status) {
    return 'Telegram · checking gateway…'
  }
  if (!gatewayRunning) {
    return 'Telegram · click to start the gateway (credentials saved)'
  }
  if (status.uiClients < 1) {
    return 'Telegram gateway running — keep this window open (uiClients must be ≥1 for DMs)'
  }
  return 'Telegram gateway running — click for menu (Open Gateway, Close, Restart, Doctor)'
}

/**
 * Canvas toolbar: with saved credentials, click starts the gateway; when running the chip is green and opens a menu.
 * Without credentials, click opens the Gateway sidebar.
 */
export function TelegramGatewayToolbarIndicator() {
  const addToast = useToastStore((s) => s.addToast)
  const [status, setStatus] = useState<OrcaGatewayStatus | null>(null)
  const [offline, setOffline] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [doctorOpen, setDoctorOpen] = useState(false)

  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel)
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed)
  const expandSidebar = useWorkspaceStore((s) => s.expandSidebar)

  const hasSaved = useSettingsStore(
    (s) => s.orcaTelegramBotToken.trim().length > 0 || s.orcaTelegramGatewayStartKnown
  )

  const anchorRef = useRef<HTMLButtonElement>(null)
  const { menuRef, fixedStyle } = useToolbarMenuPortal(menuOpen, anchorRef, 'center')

  const refresh = useCallback(async () => {
    try {
      const s = await fetchOrcaGatewayStatus()
      setStatus(s)
      setOffline(false)
    } catch {
      setStatus(null)
      setOffline(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen, menuRef])

  const gatewayRunning = Boolean(status?.telegram.running)
  const title = describeToolbarTitle(status, offline, hasSaved, gatewayRunning)

  /** Green when the gateway process is running (menu available). */
  const showGreen = gatewayRunning && !offline

  const openGatewaySidebar = () => {
    setActivePanel('gateway')
    if (sidebarCollapsed) expandSidebar()
  }

  const runStart = () => {
    setStartBusy(true)
    void startTelegramGatewayFromSavedSettings()
      .then((r) => {
        if (r.skipped) {
          addToast({
            type: 'warning',
            title: 'Telegram gateway',
            message:
              r.message ??
              'No bot token — set ORCA_TELEGRAM_BOT_TOKEN on the server or paste the token in Settings → Integrations.',
            duration: 12_000,
          })
          void refresh()
          return
        }
        addToast({
          type: 'success',
          title: 'Telegram gateway',
          message: 'Gateway started. Keep this window open (uiClients ≥ 1), then message your bot.',
          duration: 10_000,
        })
        void refresh()
      })
      .catch((e) => {
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 14_000,
        })
      })
      .finally(() => setStartBusy(false))
  }

  const onCloseGateway = () => {
    setMenuOpen(false)
    void stopOrcaNativeTelegramGateway()
      .then(() => {
        addToast({ type: 'info', title: 'Telegram gateway', message: 'Gateway stopped.' })
        void refresh()
      })
      .catch((e) =>
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 12_000,
        })
      )
  }

  const onRestartGateway = () => {
    setMenuOpen(false)
    void restartOrcaNativeTelegramGateway()
      .then(() => {
        addToast({ type: 'info', title: 'Telegram gateway', message: 'Gateway restarted.' })
        void refresh()
      })
      .catch((e) =>
        addToast({
          type: 'error',
          title: 'Telegram gateway',
          message: friendlyTelegramGatewayError(e),
          duration: 12_000,
        })
      )
  }

  const onClick = () => {
    if (!hasSaved) {
      openGatewaySidebar()
      return
    }
    if (gatewayRunning) {
      setMenuOpen((o) => !o)
      return
    }
    if (startBusy || offline) {
      if (offline) {
        addToast({
          type: 'warning',
          title: 'Telegram gateway',
          message: 'Companion server not reachable on port 3001.',
          duration: 8000,
        })
      }
      return
    }
    runStart()
  }

  return (
    <>
      <TelegramGatewayDoctorModal open={doctorOpen} onClose={() => setDoctorOpen(false)} />
      <button
        ref={anchorRef}
        type="button"
        onClick={onClick}
        disabled={startBusy}
        aria-expanded={menuOpen}
        aria-haspopup={showGreen ? 'menu' : undefined}
        className={clsx(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
          startBusy && 'opacity-60',
          showGreen
            ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            : 'border-tile-border/80 bg-black/15 text-gray-500 hover:text-gray-300'
        )}
        data-tooltip={title}
        aria-label={title}
      >
        <TelegramLogo className="h-4 w-4" />
      </button>

      {menuOpen &&
        showGreen &&
        fixedStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={fixedStyle}
            className="min-w-[12.5rem] overflow-hidden rounded-lg border border-tile-border bg-[#2d2d2d] py-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-[11px] text-gray-200 hover:bg-[#3c3c3c]"
              onClick={() => {
                setMenuOpen(false)
                openGatewaySidebar()
              }}
            >
              Open Gateway
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-[11px] text-gray-200 hover:bg-[#3c3c3c]"
              onClick={() => {
                onCloseGateway()
              }}
            >
              Close gateway
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-[11px] text-gray-200 hover:bg-[#3c3c3c]"
              onClick={() => {
                onRestartGateway()
              }}
            >
              Restart gateway
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-[11px] text-gray-200 hover:bg-[#3c3c3c]"
              onClick={() => {
                setMenuOpen(false)
                setDoctorOpen(true)
              }}
            >
              Gateway Doctor
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
