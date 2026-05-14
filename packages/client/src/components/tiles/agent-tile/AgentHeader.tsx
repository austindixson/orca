import { AgentAvatar } from '../../AgentAvatar'
import type { Provider } from '../../../store/settingsStore'
import { chipClass } from './styles'

type ModelOption = { id: string; displayName: string; isFree?: boolean; supportsImages?: boolean }

type Props = {
  delegated: boolean
  /** When true, omit duplicate model text (tile chrome subtitle already shows it). */
  hideDuplicateModelLabel: boolean
  providerColor?: string
  avatar: {
    displayName: string
    role?: string
    provider: Provider
    title: string
  } | null
  /** Local: model picker */
  availableModels: ModelOption[]
  selectedModel: string
  onModelChange: (id: string) => void
  /** Delegated: read-only label */
  executionModelLabel?: string
  showFreeBadge: boolean
  showVisionBadge: boolean
  streaming: boolean
  menuOpen: boolean
  setMenuOpen: (v: boolean) => void
  onCopyTelemetry: () => void
  onClearOutput: () => void
  onOpenSettings: () => void
  onRestartTask: () => void
  onNudge: () => void
  onClearTaskHistory: () => void
  restartDisabled: boolean
  nudgeDisabled: boolean
  clearHistoryDisabled: boolean
}

export function AgentHeader({
  delegated,
  hideDuplicateModelLabel,
  providerColor,
  avatar,
  availableModels,
  selectedModel,
  onModelChange,
  executionModelLabel,
  showFreeBadge,
  showVisionBadge,
  streaming,
  menuOpen,
  setMenuOpen,
  onCopyTelemetry,
  onClearOutput,
  onOpenSettings,
  onRestartTask,
  onNudge,
  onClearTaskHistory,
  restartDisabled,
  nudgeDisabled,
  clearHistoryDisabled,
}: Props) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-tile-border px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {avatar ? (
          <AgentAvatar
            displayName={avatar.displayName}
            role={avatar.role}
            provider={avatar.provider}
            size={28}
            editable
            data-tooltip={avatar.title}
          />
        ) : (
          <div
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: providerColor || '#888' }}
            data-tooltip="Provider"
          />
        )}
        {delegated ? (
          <span className={chipClass('cyan') + ' shrink-0 py-0 uppercase'}>Sub</span>
        ) : null}

        <div className="min-w-0 flex-1">
          {delegated ? (
            hideDuplicateModelLabel ? (
              <span className="sr-only">Model: {executionModelLabel ?? ''}</span>
            ) : (
              <span
                className="block truncate text-sm font-medium text-gray-200"
                data-tooltip="Model used for this delegated run"
              >
                {executionModelLabel ?? 'Resolving model…'}
              </span>
            )
          ) : (
            <select
              value={selectedModel || ''}
              onChange={(e) => onModelChange(e.target.value)}
              className="max-w-full cursor-pointer bg-transparent text-sm font-medium text-gray-200 outline-none hover:text-white"
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id} className="bg-tile-bg">
                  {model.displayName}
                  {model.isFree ? ' · Free' : ''}
                  {model.supportsImages ? ' · Vision' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {showFreeBadge ? <span className={chipClass('emerald') + ' shrink-0 py-0 uppercase'}>Free</span> : null}
        {showVisionBadge ? <span className={chipClass('violet') + ' shrink-0 py-0 uppercase'}>Vision</span> : null}

        <span
          className="flex shrink-0 items-center gap-1.5"
          data-tooltip={streaming ? 'Running' : 'Idle'}
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              streaming ? 'bg-accent-teal shadow-[0_0_8px_rgba(var(--accent-teal-rgb),0.72)]' : 'bg-gray-600'
            }`}
          />
        </span>
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
          }}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-tile-hover hover:text-gray-300"
          data-tooltip="Menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
          </svg>
        </button>
        {menuOpen ? (
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-tile-border bg-canvas-bg py-1 text-xs text-gray-200 shadow-lg"
          >
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500">Actions</div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRestartTask()
                setMenuOpen(false)
              }}
              disabled={restartDisabled}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover disabled:opacity-40"
            >
              Restart task
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onNudge()
                setMenuOpen(false)
              }}
              disabled={nudgeDisabled}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover disabled:opacity-40"
            >
              Nudge agent
            </button>
            <div className="my-1 border-t border-tile-border/60" />
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500">Diagnostics</div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCopyTelemetry()
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover"
            >
              Copy telemetry (JSON)
            </button>
            <div className="my-1 border-t border-tile-border/60" />
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-500">Tile</div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClearOutput()
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover"
            >
              Clear output
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClearTaskHistory()
                setMenuOpen(false)
              }}
              disabled={clearHistoryDisabled}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover disabled:opacity-40"
            >
              Clear task history
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenSettings()
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-tile-hover"
            >
              Settings
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
