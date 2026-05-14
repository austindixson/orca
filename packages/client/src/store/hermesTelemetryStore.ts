import { create } from 'zustand'

/** Max lines retained (SSE payloads can be large). */
const MAX_LINES = 5000

export function hermesTelemetryLinePrefixForTile(tileId: string): string {
  return `[tile ${tileId.slice(0, 8)}]`
}

type HermesTelemetryState = {
  lines: string[]
  /** When set, Hermes telemetry sidebar shows only lines for this tile id. */
  focusTileId: string | null
  append: (line: string) => void
  clear: () => void
  setFocusTileId: (tileId: string | null) => void
}

/**
 * Raw Hermes Responses API / SSE telemetry from all `hermes_agent` tiles — shown in the main left sidebar.
 */
export const useHermesTelemetryStore = create<HermesTelemetryState>((set, get) => ({
  lines: [],
  focusTileId: null,
  append: (line: string) => {
    set({
      lines: [...get().lines.slice(-(MAX_LINES - 1)), line],
    })
  },
  clear: () => set({ lines: [] }),
  setFocusTileId: (tileId) => set({ focusTileId: tileId }),
}))
