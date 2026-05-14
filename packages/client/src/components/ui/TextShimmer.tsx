import clsx from 'clsx'
import { tileAccentRgb } from '../../lib/tileGlow'

export type TextShimmerProps = {
  /** Status line (updates on new tools/actions — pass as React `key` from parent for sweep restart). */
  children: string
  className?: string
  /** Optional hook for tests / analytics. */
  testId?: string
  /** Full string for hover when truncated (rendered as `data-tooltip` for driver.js). */
  title?: string
  /** Cycle length for the shine sweep (seconds). */
  duration?: number
  /** Highlight width; motion-primitives default 2. */
  spread?: number
  /**
   * Canvas tile type — shimmer hue matches idle rim glow / tile chrome (see `tileGlow.ts`).
   * Use the same `TileData['type']` as the tile that hosts this verb.
   */
  tileType: string
  /**
   * Optional RGB override (space-separated for CSS `rgb(var(--orca-shimmer-rgb) / …)`).
   * Use for neutral trace/status copy instead of tile accent.
   */
  shimmerRgb?: readonly [number, number, number]
}

/**
 * Gradient text sweep inspired by
 * [Motion Primitives Text Shimmer](https://motion-primitives.com/docs/text-shimmer)
 * — no dependency on Framer Motion; verbs themselves change only when the parent passes
 * new copy (tools / orchestrator events), not on an internal word timer.
 */
export function TextShimmer({
  children,
  className,
  testId,
  title,
  duration = 4.5,
  spread = 2,
  tileType,
  shimmerRgb,
}: TextShimmerProps) {
  const spreadPct = Math.min(36, 6 + spread * 6)
  const [r, g, b] = shimmerRgb ?? tileAccentRgb(tileType)
  return (
    <span
      data-testid={testId}
      data-tooltip={title}
      className={clsx(
        'orca-text-shimmer orca-text-shimmer--accent block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-medium',
        className
      )}
      style={{
        ['--orca-shimmer-rgb' as string]: `${r} ${g} ${b}`,
        ['--orca-shimmer-duration' as string]: `${duration}s`,
        ['--orca-shimmer-spread' as string]: `${spreadPct}%`,
      }}
    >
      {children}
    </span>
  )
}
