/**
 * Agent tile design tokens — chip / label / panel grammar shared across sub-components.
 */

export const agentTileLabelClass =
  'text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500'

export const agentTilePanelClass = 'border border-tile-border bg-black/25'

/** 2px inner left stripe (teal) — use inside a relative panel */
export const agentTileTealStripeClass =
  'before:pointer-events-none before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:rounded-l before:bg-accent-teal/80'

export function chipClass(
  variant: 'cyan' | 'emerald' | 'amber' | 'rose' | 'teal' | 'violet' | 'gray'
): string {
  const map: Record<typeof variant, string> = {
    cyan: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
    teal: 'border-accent-teal/40 bg-accent-teal/10 text-accent-teal',
    violet: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
    gray: 'border-tile-border bg-black/30 text-gray-300',
  }
  return `inline-flex h-5 max-w-[min(100%,260px)] min-w-0 items-center gap-1 rounded border px-1.5 font-mono text-[10px] ${map[variant]}`
}
