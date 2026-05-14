import { useRef, useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { ActivityBar } from './ActivityBar'
import { FileExplorer } from './FileExplorer'
import { ObsidianBrainPanel } from './ObsidianBrainPanel'
import { ModulesListPanel } from './ModulesListPanel'
import { TasksSidebarPanel } from './TasksSidebarPanel'
import { TestsSidebarPanel } from './TestsSidebarPanel'
import { AgentsSidebarPanel } from './AgentsSidebarPanel'
import { HermesTelemetrySidebarPanel } from './HermesTelemetrySidebarPanel'
import { ActiveTimelineSidebarPanel } from './ActiveTimelineSidebarPanel'
import { GatewaySidebarPanel } from './GatewaySidebarPanel'
import { SidebarCanvasTips } from './SidebarCanvasTips'
function SearchPanel() {
  return (
    <div className="h-full flex flex-col bg-tile-bg/60 text-gray-300 backdrop-blur-xl">
      <div className="px-4 py-2 text-xs uppercase tracking-wider text-gray-400 border-b border-tile-border/80">
        Search
      </div>
      <div className="p-3">
        <input
          type="text"
          placeholder="Search"
          className="w-full px-3 py-1.5 bg-black/20 border border-tile-border focus:border-accent-teal text-sm text-gray-200 rounded outline-none"
        />
      </div>
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Type to search in files
      </div>
    </div>
  )
}

export function Sidebar() {
  const { sidebarWidth, sidebarCollapsed, setSidebarWidth, activePanel } = useWorkspaceStore()
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX - 48
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setSidebarWidth])

  const renderPanel = () => {
    switch (activePanel) {
      case 'modules':
        return <ModulesListPanel />
      case 'explorer':
        return <FileExplorer />
      case 'timeline':
        return <ActiveTimelineSidebarPanel />
      case 'tasks':
        return <TasksSidebarPanel />
      case 'tests':
        return <TestsSidebarPanel />
      case 'search':
        return <SearchPanel />
      case 'orchestrator':
        return <FileExplorer />
      case 'agents':
        return <AgentsSidebarPanel />
      case 'hermesTelemetry':
        return <HermesTelemetrySidebarPanel />
      case 'brain':
        return <ObsidianBrainPanel />
      case 'gateway':
        return <GatewaySidebarPanel />
      default:
        return <FileExplorer />
    }
  }

  return (
    <div data-testid="sidebar" className="h-full flex">
      <ActivityBar />

      {!sidebarCollapsed && (
        <div
          ref={sidebarRef}
          className="relative flex h-full min-h-0 flex-shrink-0 flex-col border-r border-tile-border/80 bg-tile-bg/60 backdrop-blur-xl"
          style={{ width: sidebarWidth }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderPanel()}</div>
          <SidebarCanvasTips />

          {/* Resize Handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-teal/65 transition-colors z-10"
            onMouseDown={handleMouseDown}
          />
        </div>
      )}
    </div>
  )
}
