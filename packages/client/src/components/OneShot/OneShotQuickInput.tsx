import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOrchestratorSessionStore } from '../../store/orchestratorSessionStore'
import { useOneShotStore } from '../../store/oneShotStore'
import { quickOrchestratorInputUiStore } from '../orchestrator/QuickOrchestratorInput'

type OneShotQuickInputProps = {
  open: boolean
  onClose: () => void
}

/**
 * Minimal outlined input + 1-shot button, centered in the viewport (when orchestrator is not open).
 */
const TEXTAREA_MAX_HEIGHT_PX = 280

export function OneShotQuickInput({ open, onClose }: OneShotQuickInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    syncTextareaHeight()
  }, [open, value, syncTextareaHeight])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => textareaRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const submit = async () => {
    const v = value.trim()
    if (!v) return
    const session = useOrchestratorSessionStore.getState()
    session.setOneShotMode(true)
    session.setInput(v)
    setValue('')
    onClose()
    quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(true)
    try {
      await session.run(undefined, { oneShotFromQuickInput: true })
    } finally {
      // Keep 1-shot on while optional clarify modal is open (OrchestratorModuleLayout).
      const cp = useOneShotStore.getState().clarifyPhase
      if (cp !== 'waiting' && cp !== 'generating') {
        session.setOneShotMode(false)
      }
    }
  }

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] cursor-default bg-black/20"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">
          <div className="flex items-stretch overflow-hidden rounded-lg border border-tile-border bg-canvas-bg/90 focus-within:border-accent-teal/45">
            <textarea
              ref={textareaRef}
              value={value}
              rows={1}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
              }}
              placeholder="What do you want to build?"
              className="min-h-[2.75rem] min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-snug text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0"
              aria-label="What do you want to build?"
              data-tooltip="Enter: run 1-shot · Shift+Enter: new line"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!value.trim()}
              className="shrink-0 self-stretch border-l border-tile-border px-3 py-2 text-[11px] font-medium text-accent-teal hover:bg-accent-teal/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              1-shot
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
