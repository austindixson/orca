import { create } from 'zustand'
import { useCanvasStore, TileData } from './canvasStore'

interface SavedTileState {
  id: string
  x: number
  y: number
  w: number
  h: number
}

interface FocusState {
  focusedTileIds: string[]
  isActive: boolean
  selectionBox: { x: number; y: number; width: number; height: number } | null
  isSelecting: boolean
  savedTileStates: SavedTileState[]
  savedView: { pan: { x: number; y: number }; zoom: number } | null
  
  // Selection mode (zoomed out picker)
  isSelectionMode: boolean
  selectedForFocus: string[]
  preSelectionView: { pan: { x: number; y: number }; zoom: number } | null

  /** Multi-select tiles to delete (toolbar trash → Select). */
  isDeleteSelectionMode: boolean
  selectedForDeletion: string[]
  preDeleteSelectionView: { pan: { x: number; y: number }; zoom: number } | null

  enterFocus: (tileIds: string[]) => void
  exitFocus: () => void
  toggleFocus: (tileId?: string) => void
  addToFocus: (tileId: string) => void
  removeFromFocus: (tileId: string) => void
  startSelection: (x: number, y: number) => void
  updateSelection: (x: number, y: number) => void
  endSelection: () => void
  layoutFocusedTiles: () => void
  
  // Selection mode actions
  enterSelectionMode: (initialTileId: string) => void
  toggleTileSelection: (tileId: string) => void
  confirmSelection: () => void
  cancelSelectionMode: () => void

  enterDeleteSelectionMode: () => void
  cancelDeleteSelectionMode: () => void
  toggleDeletionTileSelection: (tileId: string) => void
  addTilesToDeletionSelection: (ids: string[]) => void
}

function calculateFullscreenLayout(tiles: TileData[], viewportWidth: number, viewportHeight: number) {
  const padding = 8
  const gap = 4
  const headerHeight = 48
  
  const availableWidth = viewportWidth - padding * 2
  const availableHeight = viewportHeight - headerHeight - padding
  
  const count = tiles.length
  
  if (count === 0) return []
  
  const totalArea = tiles.reduce((sum, t) => sum + t.w * t.h, 0)
  const tilesWithWeight = tiles.map(t => ({
    ...t,
    weight: (t.w * t.h) / totalArea,
  })).sort((a, b) => b.weight - a.weight)
  
  const layouts: { id: string; x: number; y: number; w: number; h: number }[] = []
  
  if (count === 1) {
    layouts.push({
      id: tilesWithWeight[0].id,
      x: padding,
      y: headerHeight,
      w: availableWidth,
      h: availableHeight,
    })
  } else if (count === 2) {
    const [larger, smaller] = tilesWithWeight
    const largerRatio = Math.max(0.5, Math.min(0.65, larger.weight / (larger.weight + smaller.weight) + 0.1))
    
    const leftWidth = availableWidth * largerRatio - gap / 2
    const rightWidth = availableWidth * (1 - largerRatio) - gap / 2
    
    layouts.push({
      id: larger.id,
      x: padding,
      y: headerHeight,
      w: leftWidth,
      h: availableHeight,
    })
    
    layouts.push({
      id: smaller.id,
      x: padding + leftWidth + gap,
      y: headerHeight,
      w: rightWidth,
      h: availableHeight,
    })
  } else if (count === 3) {
    const [largest, ...rest] = tilesWithWeight
    const largestRatio = Math.max(0.5, Math.min(0.6, largest.weight + 0.2))
    
    const leftWidth = availableWidth * largestRatio - gap / 2
    const rightWidth = availableWidth * (1 - largestRatio) - gap / 2
    const rightItemHeight = (availableHeight - gap) / 2
    
    layouts.push({
      id: largest.id,
      x: padding,
      y: headerHeight,
      w: leftWidth,
      h: availableHeight,
    })
    
    rest.forEach((tile, i) => {
      layouts.push({
        id: tile.id,
        x: padding + leftWidth + gap,
        y: headerHeight + i * (rightItemHeight + gap),
        w: rightWidth,
        h: rightItemHeight,
      })
    })
  } else if (count === 4) {
    const cellWidth = (availableWidth - gap) / 2
    const cellHeight = (availableHeight - gap) / 2
    
    tilesWithWeight.forEach((tile, i) => {
      const row = Math.floor(i / 2)
      const col = i % 2
      
      layouts.push({
        id: tile.id,
        x: padding + col * (cellWidth + gap),
        y: headerHeight + row * (cellHeight + gap),
        w: cellWidth,
        h: cellHeight,
      })
    })
  } else {
    const cols = Math.ceil(Math.sqrt(count * (availableWidth / availableHeight)))
    const rows = Math.ceil(count / cols)
    
    const cellWidth = (availableWidth - gap * (cols - 1)) / cols
    const cellHeight = (availableHeight - gap * (rows - 1)) / rows
    
    tilesWithWeight.forEach((tile, index) => {
      const row = Math.floor(index / cols)
      const col = index % cols
      
      layouts.push({
        id: tile.id,
        x: padding + col * (cellWidth + gap),
        y: headerHeight + row * (cellHeight + gap),
        w: cellWidth,
        h: cellHeight,
      })
    })
  }
  
  return layouts
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focusedTileIds: [],
  isActive: false,
  selectionBox: null,
  isSelecting: false,
  savedTileStates: [],
  savedView: null,
  isSelectionMode: false,
  selectedForFocus: [],
  preSelectionView: null,
  isDeleteSelectionMode: false,
  selectedForDeletion: [],
  preDeleteSelectionView: null,

  enterFocus: (tileIds) => {
    if (get().isDeleteSelectionMode) {
      get().cancelDeleteSelectionMode()
    }
    const { tiles, pan, zoom, setActiveInteractionTile } = useCanvasStore.getState()
    const current = get()
    setActiveInteractionTile(null)

    /**
     * If focus mode is already active, never overwrite snapshots for tiles we already track.
     * Overwriting with fullscreen rects causes Esc restore to keep tiles fullscreen.
     */
    if (current.isActive) {
      const byId = new Map(current.savedTileStates.map((s) => [s.id, s] as const))
      for (const id of tileIds) {
        if (byId.has(id)) continue
        const t = tiles.get(id)
        if (!t) continue
        byId.set(id, { id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })
      }
      set({
        focusedTileIds: tileIds,
        isActive: true,
        savedTileStates: Array.from(byId.values()),
      })
      get().layoutFocusedTiles()
      return
    }

    const savedStates: SavedTileState[] = tileIds
      .map((id) => tiles.get(id))
      .filter((t): t is TileData => t !== undefined)
      .map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h }))

    set({
      focusedTileIds: tileIds,
      isActive: true,
      savedTileStates: savedStates,
      savedView: { pan, zoom },
    })

    get().layoutFocusedTiles()
  },

  exitFocus: () => {
    const { savedTileStates, savedView } = get()
    const { applyTilesLayout, setPan, setZoom, setActiveInteractionTile } = useCanvasStore.getState()
    setActiveInteractionTile(null)

    // Reset focus flags first (UI); geometry restore must be atomic so no frame keeps fullscreen rects.
    set({
      focusedTileIds: [],
      isActive: false,
      selectionBox: null,
      isSelecting: false,
    })

    if (savedTileStates.length > 0) {
      applyTilesLayout(
        savedTileStates.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h }))
      )
    }

    if (savedView) {
      setPan(savedView.pan)
      setZoom(savedView.zoom)
    }

    set({
      savedTileStates: [],
      savedView: null,
    })
  },

  toggleFocus: (tileId) => {
    const { isActive, focusedTileIds } = get()
    if (isActive) {
      get().exitFocus()
    } else if (tileId) {
      get().enterFocus([tileId])
    } else if (focusedTileIds.length > 0) {
      get().enterFocus(focusedTileIds)
    }
  },

  addToFocus: (tileId) => {
    const { focusedTileIds, savedTileStates } = get()
    if (focusedTileIds.includes(tileId)) return
    
    const { tiles } = useCanvasStore.getState()
    const tile = tiles.get(tileId)
    if (!tile) return
    
    const newSavedStates = [
      ...savedTileStates,
      { id: tile.id, x: tile.x, y: tile.y, w: tile.w, h: tile.h }
    ]
    
    const newIds = [...focusedTileIds, tileId]
    set({ 
      focusedTileIds: newIds,
      savedTileStates: newSavedStates,
    })
    
    get().layoutFocusedTiles()
  },

  removeFromFocus: (tileId) => {
    const { focusedTileIds, savedTileStates } = get()
    const { updateTile } = useCanvasStore.getState()
    
    const saved = savedTileStates.find(s => s.id === tileId)
    if (saved) {
      updateTile(tileId, {
        x: saved.x,
        y: saved.y,
        w: saved.w,
        h: saved.h,
      })
    }
    
    const newIds = focusedTileIds.filter(id => id !== tileId)
    const newSavedStates = savedTileStates.filter(s => s.id !== tileId)
    
    if (newIds.length === 0) {
      get().exitFocus()
    } else {
      set({ 
        focusedTileIds: newIds,
        savedTileStates: newSavedStates,
      })
      get().layoutFocusedTiles()
    }
  },

  startSelection: (x, y) => {
    set({ 
      isSelecting: true, 
      selectionBox: { x, y, width: 0, height: 0 } 
    })
  },

  updateSelection: (x, y) => {
    const { selectionBox } = get()
    if (!selectionBox) return
    
    set({
      selectionBox: {
        ...selectionBox,
        width: x - selectionBox.x,
        height: y - selectionBox.y,
      }
    })
  },

  endSelection: () => {
    set({ isSelecting: false, selectionBox: null })
  },

  layoutFocusedTiles: () => {
    const { focusedTileIds, savedTileStates } = get()
    const { tiles, updateTile, setPan, setZoom } = useCanvasStore.getState()
    
    if (focusedTileIds.length === 0) return
    
    const tilesForLayout = focusedTileIds
      .map(id => {
        const saved = savedTileStates.find(s => s.id === id)
        const current = tiles.get(id)
        if (!current) return null
        
        return {
          ...current,
          w: saved?.w ?? current.w,
          h: saved?.h ?? current.h,
        }
      })
      .filter((t): t is TileData => t !== null)
    
    if (tilesForLayout.length === 0) return
    
    setPan({ x: 0, y: 0 })
    setZoom(1)
    
    const layouts = calculateFullscreenLayout(
      tilesForLayout,
      window.innerWidth,
      window.innerHeight
    )
    
    const sortedIds = layouts.map(l => l.id)
    set({ focusedTileIds: sortedIds })
    
    layouts.forEach(layout => {
      updateTile(layout.id, {
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
      })
    })
  },

  enterSelectionMode: (initialTileId) => {
    const { tiles, pan, zoom, setPan, setZoom } = useCanvasStore.getState()
    const tilesArray = Array.from(tiles.values())
    
    if (tilesArray.length === 0) return

    get().cancelDeleteSelectionMode()

    // Save current view
    set({
      isSelectionMode: true,
      selectedForFocus: [initialTileId],
      preSelectionView: { pan, zoom },
    })
    
    // Calculate bounds to fit all tiles
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    tilesArray.forEach(tile => {
      minX = Math.min(minX, tile.x)
      minY = Math.min(minY, tile.y)
      maxX = Math.max(maxX, tile.x + tile.w)
      maxY = Math.max(maxY, tile.y + tile.h)
    })
    
    const padding = 100
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding
    
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    
    // Calculate zoom to fit all tiles
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const zoomX = viewportWidth / contentWidth
    const zoomY = viewportHeight / contentHeight
    const newZoom = Math.min(zoomX, zoomY, 1) * 0.9
    
    // Center the view
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const newPanX = (viewportWidth / 2) - (centerX * newZoom)
    const newPanY = (viewportHeight / 2) - (centerY * newZoom)
    
    setPan({ x: newPanX, y: newPanY })
    setZoom(newZoom)
  },

  toggleTileSelection: (tileId) => {
    const { selectedForFocus } = get()
    
    if (selectedForFocus.includes(tileId)) {
      // Don't allow deselecting if it's the last one
      if (selectedForFocus.length > 1) {
        set({ selectedForFocus: selectedForFocus.filter(id => id !== tileId) })
      }
    } else {
      set({ selectedForFocus: [...selectedForFocus, tileId] })
    }
  },

  confirmSelection: () => {
    const { selectedForFocus, preSelectionView } = get()
    const { setPan, setZoom } = useCanvasStore.getState()

    if (preSelectionView) {
      setPan(preSelectionView.pan)
      setZoom(preSelectionView.zoom)
    }
    
    // Clear selection mode state
    set({
      isSelectionMode: false,
      selectedForFocus: [],
      preSelectionView: null,
    })
    
    // Enter focus with selected tiles
    if (selectedForFocus.length > 0) {
      get().enterFocus(selectedForFocus)
    }
  },

  cancelSelectionMode: () => {
    const { preSelectionView } = get()
    const { setPan, setZoom } = useCanvasStore.getState()
    
    // Restore original view
    if (preSelectionView) {
      setPan(preSelectionView.pan)
      setZoom(preSelectionView.zoom)
    }
    
    set({
      isSelectionMode: false,
      selectedForFocus: [],
      preSelectionView: null,
    })
  },

  enterDeleteSelectionMode: () => {
    const { tiles, pan, zoom, setPan, setZoom } = useCanvasStore.getState()
    const tilesArray = Array.from(tiles.values())

    if (tilesArray.length === 0) return

    get().cancelSelectionMode()
    if (get().isActive) get().exitFocus()

    set({
      isDeleteSelectionMode: true,
      selectedForDeletion: [],
      preDeleteSelectionView: { pan, zoom },
    })

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    tilesArray.forEach((tile) => {
      minX = Math.min(minX, tile.x)
      minY = Math.min(minY, tile.y)
      maxX = Math.max(maxX, tile.x + tile.w)
      maxY = Math.max(maxY, tile.y + tile.h)
    })

    const padding = 100
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding

    const contentWidth = maxX - minX
    const contentHeight = maxY - minY

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const zoomX = viewportWidth / contentWidth
    const zoomY = viewportHeight / contentHeight
    const newZoom = Math.min(zoomX, zoomY, 1) * 0.9

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const newPanX = viewportWidth / 2 - centerX * newZoom
    const newPanY = viewportHeight / 2 - centerY * newZoom

    setPan({ x: newPanX, y: newPanY })
    setZoom(newZoom)
  },

  cancelDeleteSelectionMode: () => {
    const { preDeleteSelectionView } = get()
    const { setPan, setZoom } = useCanvasStore.getState()

    if (preDeleteSelectionView) {
      setPan(preDeleteSelectionView.pan)
      setZoom(preDeleteSelectionView.zoom)
    }

    set({
      isDeleteSelectionMode: false,
      selectedForDeletion: [],
      preDeleteSelectionView: null,
    })
  },

  toggleDeletionTileSelection: (tileId) => {
    const { selectedForDeletion } = get()
    if (selectedForDeletion.includes(tileId)) {
      set({ selectedForDeletion: selectedForDeletion.filter((id) => id !== tileId) })
    } else {
      set({ selectedForDeletion: [...selectedForDeletion, tileId] })
    }
  },

  addTilesToDeletionSelection: (ids) => {
    const { selectedForDeletion } = get()
    const next = new Set([...selectedForDeletion, ...ids])
    set({ selectedForDeletion: Array.from(next) })
  },
}))

export const useFocusedTileId = () => {
  const focusedTileIds = useFocusStore((s) => s.focusedTileIds)
  return focusedTileIds[0] ?? null
}
