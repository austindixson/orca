import { useEffect, useState } from 'react'
import { CLAW_SPINNER_FRAMES } from '../lib/orchestrator/orchestratorShimmerVerbs'

const TICK_MS = 90

/**
 * Braille spinner cycle matching
 * {@link https://github.com/ultraworkers/claw-code/blob/main/rust/crates/rusty-claude-cli/src/render.rs `Spinner::FRAMES`}
 * in claw-code (Claude Code–style CLI).
 */
export function useClawSpinnerFrame(active: boolean): string {
  const [i, setI] = useState(0)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!active || reduced) {
      setI(0)
      return
    }
    const id = window.setInterval(() => {
      setI((x) => (x + 1) % CLAW_SPINNER_FRAMES.length)
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [active, reduced])

  const frame = CLAW_SPINNER_FRAMES[i] ?? CLAW_SPINNER_FRAMES[0] ?? '⠋'
  return frame
}
