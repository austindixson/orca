import { ExplorerTasksPanel } from './ExplorerTasksPanel'

/** Tasks activity: full-height task list in the left sidebar (same store as explorer split). */
export function TasksSidebarPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ExplorerTasksPanel variant="full" />
      </div>
    </div>
  )
}
