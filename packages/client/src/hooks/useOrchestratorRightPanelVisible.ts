import { useFocusStore } from '../store/focusStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useCanvasStore } from '../store/canvasStore'

/**
 * True when the docked right orchestrator column is rendered (see App.tsx).
 * Plan workspace and focus/selection overlays hide that column even if `activePanel` is still `orchestrator`.
 */
export function useOrchestratorRightPanelVisible(): boolean {
  const { isActive, isSelectionMode, isDeleteSelectionMode } = useFocusStore()
  const activePanel = useWorkspaceStore((s) => s.activePanel)
  const planWorkspaceOpen = useCanvasStore((s) => s.canvasViewMode === 'plan')
  const hideSidebar = isActive || isSelectionMode || isDeleteSelectionMode
  return !hideSidebar && activePanel === 'orchestrator' && !planWorkspaceOpen
}
