import { create } from 'zustand'
import {
  type BrainGraph,
  type NodePosition,
  buildObsidianBrainGraph,
  layoutBrainGraph,
  pickBrainRootPath,
  roomHue,
} from '../lib/memPalace/buildObsidianBrainGraph'

export type { BrainGraph, NodePosition }

interface MemPalaceState {
  graph: BrainGraph | null
  positions: Map<string, NodePosition>
  /** Pinned center node for layout + viewport (e.g. wiki/index.md). */
  rootPath: string | null
  /** Pan / zoom for the SVG viewport */
  view: { tx: number; ty: number; scale: number }
  selectedPath: string | null
  scanning: boolean
  error: string | null
  lastScanAt: number | null
  /** Memo: room -> color */
  roomColor: (room: string) => string

  scan: () => Promise<void>
  setSelectedPath: (path: string | null) => void
  setView: (partial: Partial<MemPalaceState['view']>) => void
  resetView: () => void
  /** Place the root note at the center of the SVG viewport (call with svg client width/height). */
  centerViewOnRoot: (svgWidth: number, svgHeight: number) => void
}

const LAYOUT_W = 520
const LAYOUT_H = 420

export const useMemPalaceStore = create<MemPalaceState>((set, get) => ({
  graph: null,
  positions: new Map(),
  rootPath: null,
  view: { tx: 0, ty: 0, scale: 1 },
  selectedPath: null,
  scanning: false,
  error: null,
  lastScanAt: null,
  roomColor: roomHue,

  scan: async () => {
    if (get().scanning) return
    set({ scanning: true, error: null })
    try {
      const graph = await buildObsidianBrainGraph()
      const rootPath = pickBrainRootPath(graph)
      const positions = layoutBrainGraph(graph, LAYOUT_W, LAYOUT_H, 60, rootPath)
      set({
        graph,
        positions,
        rootPath,
        lastScanAt: Date.now(),
        scanning: false,
        error: null,
        selectedPath: null,
        view: { tx: 0, ty: 0, scale: 1 },
      })
    } catch (e) {
      set({
        scanning: false,
        error: e instanceof Error ? e.message : 'Scan failed',
      })
    }
  },

  setSelectedPath: (path) => set({ selectedPath: path }),

  setView: (partial) =>
    set((s) => ({
      view: {
        ...s.view,
        ...partial,
        scale: partial.scale != null ? Math.min(3, Math.max(0.35, partial.scale)) : s.view.scale,
      },
    })),

  centerViewOnRoot: (svgWidth, svgHeight) => {
    const { positions, rootPath, view } = get()
    if (!rootPath || svgWidth <= 0 || svgHeight <= 0) return
    const p = positions.get(rootPath)
    if (!p) return
    const scale = view.scale
    set({
      view: {
        tx: svgWidth / 2 - p.x * scale,
        ty: svgHeight / 2 - p.y * scale,
        scale,
      },
    })
  },

  resetView: () => set({ view: { tx: 0, ty: 0, scale: 1 } }),
}))

export const MEM_PALACE_LAYOUT = { width: LAYOUT_W, height: LAYOUT_H }
