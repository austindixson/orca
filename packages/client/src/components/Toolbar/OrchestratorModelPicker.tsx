import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  useSettingsStore,
  PROVIDER_INFO,
  sortModelsForDisplay,
  type Provider,
} from '../../store/settingsStore'
import { providerSupportsOrchestratorTools } from '../../lib/orchestrator/types'

export function OrchestratorModelPicker({ hideLabel = false }: { hideLabel?: boolean }) {
  const providers = useSettingsStore((s) => s.providers)
  const ollamaModels = useSettingsStore((s) => s.ollamaModels)
  const shellCredentialFlags = useSettingsStore((s) => s.shellCredentialFlags)
  const getAvailableModels = useSettingsStore((s) => s.getAvailableModels)
  const selectedModel = useSettingsStore((s) => s.selectedModel)
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)

  const [open, setOpen] = useState(false)
  const [dropAlignRight, setDropAlignRight] = useState(false)
  const [dropOpenUp, setDropOpenUp] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  const availableModels = useMemo(
    () => sortModelsForDisplay(getAvailableModels()),
    [getAvailableModels, providers, ollamaModels, shellCredentialFlags]
  )
  const current = useMemo(
    () => availableModels.find((m) => m.id === selectedModel) ?? null,
    [availableModels, selectedModel]
  )

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const MARGIN = 16
    const EST_DROPDOWN_W = 320
    const EST_DROPDOWN_H = 360
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) {
      const roomRight = window.innerWidth - rect.left
      const roomLeft = rect.right
      setDropAlignRight(roomRight < EST_DROPDOWN_W + MARGIN && roomLeft > roomRight)

      // Prefer opening upward from the footer, but if there is not enough room, open downward.
      const roomAbove = rect.top
      const roomBelow = window.innerHeight - rect.bottom
      setDropOpenUp(roomAbove >= EST_DROPDOWN_H || roomAbove >= roomBelow)
    }

    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open, close])

  const pick = (id: string) => {
    setSelectedModel(id)
    close()
  }

  const providerDot = (p: Provider) => (
    <span
      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/10"
      style={{ backgroundColor: PROVIDER_INFO[p].color }}
      aria-hidden
    />
  )

  return (
    <div ref={wrapRef} className="relative inline-flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-[min(100%,28rem)]">
      {!hideLabel && (
        <>
          <span className="shrink-0 text-gray-500">Orchestrator</span>
          <span className="text-gray-600" aria-hidden>
            ·
          </span>
        </>
      )}

      {availableModels.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            toggleSettings()
            close()
          }}
          className="min-w-0 truncate rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-left text-xs text-amber-200/90 hover:border-amber-400/60 hover:bg-amber-500/15"
        >
          Enable a provider in Settings →
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={clsx(
              'group flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-left text-xs transition-colors',
              open
                ? 'border-accent-teal/50 bg-accent-teal/10 text-gray-100'
                : 'border-tile-border/80 bg-canvas-bg/90 text-gray-200 hover:border-accent-teal/35 hover:bg-tile-hover/60'
            )}
            aria-expanded={open}
            aria-haspopup="listbox"
            data-tooltip="Change model for this chat"
          >
            {current ? (
              <>
                {providerDot(current.provider)}
                <span className="min-w-0 flex-1 truncate font-medium text-gray-100">
                  {current.displayName}
                </span>
                <span className="hidden shrink-0 text-[10px] text-gray-500 sm:inline">
                  {PROVIDER_INFO[current.provider].name}
                </span>
                {current.isFree && (
                  <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                    Free
                  </span>
                )}
                {current.supportsImages && (
                  <span className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                    Vision
                  </span>
                )}
              </>
            ) : (
              <span className="text-amber-200/90">Choose a model…</span>
            )}
            <svg
              className={clsx(
                'h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform group-hover:text-gray-400',
                open && '-rotate-180'
              )}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="LLM models"
              className={clsx(
                'absolute z-[85] flex min-h-0 max-h-[min(50vh,20rem)] w-[min(calc(100vw-2rem),20rem)] flex-col overflow-hidden rounded-xl border border-tile-border bg-tile-bg shadow-2xl',
                dropOpenUp ? 'bottom-full mb-2' : 'top-full mt-2',
                dropAlignRight ? 'right-0' : 'left-0'
              )}
            >
              {/* Header stays above the scroll region — avoids sticky+overflow overlap bugs */}
              <div className="shrink-0 border-b border-tile-border/80 bg-tile-header px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Model</p>
                <p className="mt-1 text-[11px] leading-snug text-gray-500">
                  Models with <span className="text-accent-teal">Tools</span> run the canvas orchestrator (files,
                  tiles). Others are listed for quick switching if you add them later.
                </p>
              </div>

              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {availableModels.map((m) => {
                  const tools = providerSupportsOrchestratorTools(m.provider) && m.supportsTools !== false
                  const active = m.id === selectedModel
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => pick(m.id)}
                        className={clsx(
                          'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors',
                          active ? 'bg-accent-teal/15 text-white' : 'text-gray-200 hover:bg-tile-hover'
                        )}
                      >
                        <span className="mt-0.5">{providerDot(m.provider)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.displayName}</span>
                          <span className="mt-0.5 block text-[10px] text-gray-500">
                            {PROVIDER_INFO[m.provider].name}
                          </span>
                        </span>
                        {tools ? (
                          <div className="flex shrink-0 items-center gap-1">
                            {m.isFree && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                                Free
                              </span>
                            )}
                            {m.supportsImages && (
                              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                                Vision
                              </span>
                            )}
                            <span className="rounded bg-accent-teal/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-teal">
                              Tools
                            </span>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            {m.isFree && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                                Free
                              </span>
                            )}
                            {m.supportsImages && (
                              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
                                Vision
                              </span>
                            )}
                            <span className="rounded bg-gray-600/30 px-1.5 py-0.5 text-[9px] text-gray-500">
                              Chat
                            </span>
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="shrink-0 border-t border-tile-border/80 bg-tile-header px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => {
                    toggleSettings()
                    close()
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-[11px] text-gray-500 transition-colors hover:bg-tile-hover hover:text-gray-300"
                >
                  API keys &amp; full model list in Settings →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
