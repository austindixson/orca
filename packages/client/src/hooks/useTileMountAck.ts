/**
 * Hook for tiles to acknowledge mount completion to the workspace rebuild scheduler.
 * Heavy tiles call ack() after their first meaningful paint / WS connection / frame.
 */

import { useCallback, useEffect, useRef } from 'react'

type AckListener = (tileId: string) => void

const listeners = new Set<AckListener>()
const ackedTiles = new Set<string>()

/**
 * Subscribe to mount-ack events (used by the rebuild scheduler).
 * Returns unsubscribe function.
 */
export function subscribeTileMountAck(listener: AckListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Check if a tile has already acknowledged mount.
 */
export function hasTileAcked(tileId: string): boolean {
  return ackedTiles.has(tileId)
}

/**
 * Clear ack state for a tile (called when tile is removed or rebuild resets).
 */
export function clearTileAck(tileId: string): void {
  ackedTiles.delete(tileId)
}

/**
 * Clear all ack state (called at start of rebuild).
 */
export function clearAllTileAcks(): void {
  ackedTiles.clear()
}

/**
 * Emit a mount-ack for a tile (internal, used by the hook).
 */
function emitMountAck(tileId: string): void {
  if (ackedTiles.has(tileId)) return
  ackedTiles.add(tileId)
  for (const listener of listeners) {
    try {
      listener(tileId)
    } catch (e) {
      console.error('[useTileMountAck] listener error:', e)
    }
  }
}

/**
 * Returns promise that resolves when the tile acks (or times out).
 */
export function waitForTileMountAck(tileId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (ackedTiles.has(tileId)) {
      resolve()
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let unsub: (() => void) | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      unsub?.()
    }

    unsub = subscribeTileMountAck((id) => {
      if (id === tileId) {
        cleanup()
        resolve()
      }
    })

    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)
  })
}

/**
 * Hook for tiles to acknowledge mount completion.
 * Returns an `ack` function that should be called once the tile is ready.
 * 
 * @param tileId - The tile's unique ID
 * @param autoAckOnMount - If true, automatically ack in useEffect (for light tiles)
 * 
 * @example
 * // Heavy tile: call ack manually after ready
 * const ack = useTileMountAck(tileId)
 * useEffect(() => {
 *   ws.onopen = () => ack()
 * }, [])
 * 
 * @example
 * // Light tile: auto-ack on mount
 * useTileMountAck(tileId, true)
 */
export function useTileMountAck(tileId: string, autoAckOnMount = false): () => void {
  const ackedRef = useRef(false)

  const ack = useCallback(() => {
    if (ackedRef.current) return
    ackedRef.current = true
    emitMountAck(tileId)
  }, [tileId])

  useEffect(() => {
    if (autoAckOnMount) {
      ack()
    }
  }, [autoAckOnMount, ack])

  useEffect(() => {
    return () => {
      ackedRef.current = false
    }
  }, [tileId])

  return ack
}

/**
 * Component wrapper that auto-acks on mount.
 * Wrap light/medium tiles that don't need custom ack timing.
 */
export function TileAckOnMount({ tileId }: { tileId: string }): null {
  useTileMountAck(tileId, true)
  return null
}
