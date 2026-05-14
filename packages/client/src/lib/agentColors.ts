/**
 * Agent color palette for visual variety on the canvas:
 * hub-link hues, tile frame accents, group chat chrome, etc.
 *
 * Stable assignment: the Nth agent in a session can use palette[N % palette.length].
 * Names are user-facing labels while ids are stable keys.
 */

export type AgentColorId =
  | 'red'
  | 'blue'
  | 'orange'
  | 'violet'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'lime'

export interface AgentColorEntry {
  id: AgentColorId
  /** Human-readable label (e.g. “Red”). */
  label: string
  /** 0–360 hue for HSL strokes in the hub-link SVG. */
  hue: number
  /** Solid hex (full opacity) — headers, stripes, badges. */
  hex: string
  /** Accent CSS rgba at low opacity — used for inset ring / subtle frame. */
  softRgba: string
}

/** Ordered list — `AGENT_PALETTE_ORDER[i]` = the `i`-th slot’s color in a session. */
export const AGENT_PALETTE_ORDER: AgentColorId[] = [
  'red',
  'blue',
  'orange',
  'violet',
  'teal',
  'amber',
  'rose',
  'lime',
]

export const AGENT_PALETTE: Record<AgentColorId, AgentColorEntry> = {
  red: {
    id: 'red',
    label: 'Red',
    hue: 0,
    hex: '#ef4444',
    softRgba: 'rgba(239, 68, 68, 0.35)',
  },
  blue: {
    id: 'blue',
    label: 'Blue',
    hue: 214,
    hex: '#3b82f6',
    softRgba: 'rgba(59, 130, 246, 0.35)',
  },
  orange: {
    id: 'orange',
    label: 'Orange',
    hue: 28,
    hex: '#f97316',
    softRgba: 'rgba(249, 115, 22, 0.35)',
  },
  violet: {
    id: 'violet',
    label: 'Violet',
    hue: 268,
    hex: '#8b5cf6',
    softRgba: 'rgba(139, 92, 246, 0.35)',
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    hue: 172,
    hex: '#14b8a6',
    softRgba: 'rgba(20, 184, 166, 0.35)',
  },
  amber: {
    id: 'amber',
    label: 'Amber',
    hue: 42,
    hex: '#f59e0b',
    softRgba: 'rgba(245, 158, 11, 0.35)',
  },
  rose: {
    id: 'rose',
    label: 'Rose',
    hue: 338,
    hex: '#f43f5e',
    softRgba: 'rgba(244, 63, 94, 0.35)',
  },
  lime: {
    id: 'lime',
    label: 'Lime',
    hue: 82,
    hex: '#84cc16',
    softRgba: 'rgba(132, 204, 22, 0.35)',
  },
}

/** Pick the next color by index (wraps). */
export function pickAgentColorIdByIndex(index: number): AgentColorId {
  const n = AGENT_PALETTE_ORDER.length
  const i = ((index % n) + n) % n
  return AGENT_PALETTE_ORDER[i]
}

/** Stable string key for accents (e.g. CSS data attributes). */
export function agentAccentKey(colorId: AgentColorId): string {
  return colorId
}
