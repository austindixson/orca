import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ClarifyingAnswer, ClarifyingQuestion } from '../../lib/orchestrator/oneShot/oneShotTypes'

type OneShotClarifyModalProps = {
  questions: ClarifyingQuestion[]
  onSubmit: (answers: ClarifyingAnswer[]) => void
  onSkip: () => void
  onCancel?: () => void
  onFocusQuestionChange?: (index: number) => void
}

/**
 * Cursor plan-style MC: up to 3 questions, 4 options each (4 is Other + optional text).
 * Keys 1–4 choose the option for the focused question; Enter submits when complete.
 * (Loading state while the model runs is shown in the orchestrator chat + status strip, not here.)
 */
export function OneShotClarifyModal({
  questions,
  onSubmit,
  onSkip,
  onCancel,
  onFocusQuestionChange,
}: OneShotClarifyModalProps) {
  const [focusIdx, setFocusIdx] = useState(0)
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [customById, setCustomById] = useState<Record<string, string>>({})
  const questionCardRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Dialog body scroller — flex parents need min-h-0 + explicit scroll for scrollIntoView to affect the panel, not only the window. */
  const scrollRootRef = useRef<HTMLDivElement>(null)
  /** Footer (Continue / Skip) — scroll into view on the last question so actions stay reachable. */
  const footerActionsRef = useRef<HTMLDivElement>(null)

  const questionsKey = useMemo(() => questions.map((q) => q.id).join('\u0000'), [questions])

  useEffect(() => {
    setFocusIdx(0)
    setSelected({})
    setCustomById({})
  }, [questionsKey])

  useEffect(() => {
    onFocusQuestionChange?.(focusIdx)
  }, [focusIdx, onFocusQuestionChange])

  const focusedQuestion = questions[focusIdx]

  const canContinue = useMemo(() => {
    if (questions.length === 0) return true
    for (const q of questions) {
      if (selected[q.id] === undefined) return false
    }
    return true
  }, [questions, selected])

  const buildAnswers = useCallback((): ClarifyingAnswer[] => {
    return questions.map((q) => {
      const sel = selected[q.id] ?? 1
      const answer: ClarifyingAnswer = {
        questionId: q.id,
        selectedOption: sel,
      }
      if (sel === 4) {
        const t = (customById[q.id] ?? '').trim()
        if (t) answer.customText = t
      }
      return answer
    })
  }, [questions, selected, customById])

  /** Scroll the active question into the dialog viewport and focus that card (open + after each answer). */
  useLayoutEffect(() => {
    if (questions.length === 0) return

    const scrollFocusedCardIntoPlace = () => {
      const el = questionCardRefs.current[focusIdx]
      const root = scrollRootRef.current
      if (!el) return

      if (root) {
        const pad = 10
        const rr = root.getBoundingClientRect()
        const er = el.getBoundingClientRect()
        if (er.top < rr.top + pad) {
          root.scrollBy({ top: er.top - rr.top - pad, behavior: 'smooth' })
        } else if (er.bottom > rr.bottom - pad) {
          root.scrollBy({ top: er.bottom - rr.bottom + pad, behavior: 'smooth' })
        }
        // Last question: ensure Continue / Skip stays in the scrollable viewport (short modals clip the footer).
        const isLastQuestion = focusIdx === questions.length - 1 && questions.length > 0
        if (isLastQuestion && footerActionsRef.current) {
          requestAnimationFrame(() => {
            const root2 = scrollRootRef.current
            const foot = footerActionsRef.current
            if (!root2 || !foot) return
            const rr2 = root2.getBoundingClientRect()
            const fr = foot.getBoundingClientRect()
            if (fr.bottom > rr2.bottom - pad) {
              root2.scrollBy({ top: fr.bottom - rr2.bottom + pad, behavior: 'smooth' })
            }
          })
        }
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
      }

      // Defer focus past the activating click / browser default focus so the highlighted card reliably receives focus.
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          el.focus({ preventScroll: true })
        })
      })
    }

    scrollFocusedCardIntoPlace()
  }, [focusIdx, questions.length, questionsKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (canContinue) {
          e.preventDefault()
          onSubmit(buildAnswers())
        }
        return
      }
      if (focusedQuestion && /^[1-4]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          if (e.key !== 'Escape') return
        }
        e.preventDefault()
        const n = Number(e.key) as 1 | 2 | 3 | 4
        const q = focusedQuestion
        setSelected((prev) => ({ ...prev, [q.id]: n }))
        if (n !== 4 && focusIdx < questions.length - 1) {
          setFocusIdx((i) => i + 1)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedQuestion, focusIdx, questions.length, canContinue, buildAnswers, onSubmit, onSkip])

  if (questions.length === 0) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={scrollRootRef}
        className="max-h-[min(90vh,520px)] w-full max-w-lg min-h-0 overflow-y-auto rounded-lg border border-tile-border bg-canvas-bg/95 p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oneshot-clarify-title"
      >
        <h2 id="oneshot-clarify-title" className="text-sm font-semibold text-gray-100">
          Quick clarifications
        </h2>
        <p className="mt-1 text-[11px] text-gray-500">
          Research finished first; <span className="text-gray-400">option 1</span> is the suggested path from those findings (see the one-line rationale in the label). Press{' '}
          <kbd className="rounded bg-gray-800 px-1">1</kbd>–
          <kbd className="rounded bg-gray-800 px-1">4</kbd> for the highlighted question.{' '}
          <kbd className="rounded bg-gray-800 px-1">Enter</kbd> continue ·{' '}
          <kbd className="rounded bg-gray-800 px-1">Esc</kbd> skip.
        </p>

        <div className="mt-4 space-y-5">
          {questions.map((q, qi) => {
            const isFocused = focusIdx === qi
            const sel = selected[q.id]
            return (
              <div
                key={q.id}
                ref={(el) => {
                  questionCardRefs.current[qi] = el
                }}
                tabIndex={isFocused ? 0 : -1}
                className={`rounded-md border p-3 outline-none transition-colors scroll-mt-2 focus-visible:ring-2 focus-visible:ring-accent-teal/45 ${
                  isFocused ? 'border-accent-teal/60 bg-accent-teal/5 ring-1 ring-accent-teal/30' : 'border-tile-border/80 bg-black/20'
                }`}
                onClick={(e) => {
                  // Option buttons stopPropagation so choosing an answer does not fire this and overwrite focus advance.
                  if ((e.target as HTMLElement).closest('button[type="button"]')) return
                  setFocusIdx(qi)
                }}
              >
                <p className="text-[13px] font-medium text-gray-200">{q.question}</p>
                <ul className="mt-2 space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const num = (oi + 1) as 1 | 2 | 3 | 4
                    const isSel = sel === num
                    const isOther = num === 4
                    return (
                      <li key={oi}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected((prev) => ({ ...prev, [q.id]: num }))
                            if (num !== 4 && qi < questions.length - 1) {
                              setFocusIdx(qi + 1)
                            }
                          }}
                          className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                            isSel
                              ? 'bg-accent-teal/20 text-accent-teal'
                              : 'text-gray-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="mt-0.5 w-5 shrink-0 font-mono text-[10px] text-gray-500">
                            {num}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {oi === 0 && !isOther && (
                              <span className="rounded bg-accent-teal/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-teal">
                                Suggested
                              </span>
                            )}
                            <span>{isOther ? 'Other (type below)' : opt}</span>
                          </span>
                        </button>
                        {isOther && isSel && (
                          <input
                            autoFocus={qi === focusIdx && sel === 4}
                            type="text"
                            value={customById[q.id] ?? ''}
                            onChange={(e) =>
                              setCustomById((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="Fill in…"
                            className="ml-7 mt-1 w-[calc(100%-1.75rem)] rounded border border-tile-border bg-black/30 px-2 py-1 text-[12px] text-gray-100 placeholder:text-gray-600 focus:border-accent-teal/50 focus:outline-none"
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>

        <div
          ref={footerActionsRef}
          className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-tile-border/80 pt-3"
        >
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded bg-gray-800 px-3 py-1.5 text-[11px] text-gray-400 hover:bg-gray-700"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onSkip}
            className="rounded bg-gray-800 px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-700"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => onSubmit(buildAnswers())}
            className="rounded bg-accent-teal/90 px-3 py-1.5 text-[11px] font-medium text-gray-950 hover:bg-accent-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
