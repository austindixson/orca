import { create } from 'zustand'

export interface ElementHighlightRect {
  x: number
  y: number
  width: number
  height: number
}

interface ElementHighlightState {
  /** browserTileId → rect in iframe client coordinates (relative to iframe) */
  rects: Record<string, ElementHighlightRect | null>
  setHoverRect: (browserTileId: string, rect: ElementHighlightRect | null) => void
  clearForBrowser: (browserTileId: string) => void
}

export const useElementHighlightStore = create<ElementHighlightState>((set) => ({
  rects: {},
  setHoverRect: (browserTileId, rect) =>
    set((s) => ({
      rects: { ...s.rects, [browserTileId]: rect },
    })),
  clearForBrowser: (browserTileId) =>
    set((s) => {
      const next = { ...s.rects }
      delete next[browserTileId]
      return { rects: next }
    }),
}))
