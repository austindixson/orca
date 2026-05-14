/**
 * Auto-focus anchor Y (in canvas-local px):
 * midpoint between screen top (0) and narrator top.
 * Falls back to viewport center when narrator is hidden.
 */
export function getOrchestratorAutoFocusAnchorY(canvasRect: DOMRect): number {
  if (typeof document === 'undefined') {
    return canvasRect.height / 2
  }
  const hud = document.querySelector('[data-testid="orchestrator-canvas-hud"]') as HTMLElement | null
  if (!hud) {
    return canvasRect.height / 2
  }
  const hudRect = hud.getBoundingClientRect()
  const hudTop = hudRect.top
  if (!Number.isFinite(hudTop) || hudTop <= 0) {
    return canvasRect.height / 2
  }
  const anchorScreenY = hudTop / 2
  const anchorInCanvas = anchorScreenY - canvasRect.top
  return Math.max(0, Math.min(canvasRect.height, anchorInCanvas))
}
