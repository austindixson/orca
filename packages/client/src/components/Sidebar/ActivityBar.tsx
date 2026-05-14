import clsx from 'clsx'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSettingsStore } from '../../store/settingsStore'
import { openKeyboardShortcutsModal } from '../../lib/uiEvents'

const ACTIVITY_ITEMS = [
  {
    id: 'explorer' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
      </svg>
    ),
    label: 'Explorer',
    tooltip: 'Browse the workspace file tree, open files, and manage the explorer split.',
  },
  {
    id: 'timeline' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-6" />
        <path d="M22 20V8" />
      </svg>
    ),
    label: 'Timeline',
    tooltip: 'Review git history, file changes, and activity over time.',
  },
  {
    id: 'tasks' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    label: 'Tasks',
    tooltip: 'Track project tasks and checklists alongside your workspace.',
  },
  {
    id: 'tests' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 12l2 2 4-4" />
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
    ),
    label: 'Tests',
    tooltip: 'Run and inspect tests for the open project.',
  },
  {
    id: 'agents' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    label: 'Agents',
    tooltip: 'Manage agent sessions, delegation, and team tiles from the sidebar.',
  },
  {
    id: 'hermesTelemetry' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h2l2-7 3 14 3-10 3 8h2" />
      </svg>
    ),
    label: 'Telemetry',
    tooltip: 'View Hermes bridge and integration telemetry in one place.',
  },
  {
    id: 'modules' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </svg>
    ),
    label: 'Tiles',
    tooltip: 'List every canvas tile, jump to one, or remove tiles in bulk.',
  },
  {
    id: 'search' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21L16.65 16.65" />
      </svg>
    ),
    label: 'Search',
    tooltip: 'Search files and symbols across the open workspace.',
  },
  {
    id: 'brain' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="6" cy="7" r="2.25" />
        <circle cx="18" cy="6" r="2.25" />
        <circle cx="16" cy="17" r="2.25" />
        <circle cx="7" cy="17" r="2.25" />
        <path d="M7.8 8.2L14.5 6.8M15.8 15.2l1.5-6.5M8.5 15.5l6-1M6.8 9.2l.5 6" />
      </svg>
    ),
    label: 'Obsidian brain',
    tooltip: 'Open the Obsidian vault brain panel for notes and mirrored orchestrator context.',
  },
  {
    id: 'gateway' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
    label: 'Gateway',
    tooltip: 'Configure Telegram and other messaging gateways that feed the harness.',
  },
  {
    id: 'orchestrator' as const,
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    label: 'Orchestrator',
    tooltip: 'Open the orchestrator chat and session controls in the sidebar.',
  },
]

export function ActivityBar() {
  const { activePanel, setActivePanel, sidebarCollapsed, toggleSidebar, expandSidebar } = useWorkspaceStore()
  const { toggleSettings } = useSettingsStore()

  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-tile-border/80 bg-tile-bg/60 py-2 backdrop-blur-xl">
      {ACTIVITY_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            if (item.id === 'orchestrator') {
              if (activePanel === 'orchestrator') {
                setActivePanel('explorer')
              } else {
                setActivePanel('orchestrator')
                if (sidebarCollapsed) expandSidebar()
              }
              return
            }
            if (activePanel === item.id && !sidebarCollapsed) {
              toggleSidebar()
            } else {
              setActivePanel(item.id)
              if (sidebarCollapsed) expandSidebar()
            }
          }}
          className={clsx(
            'w-12 h-12 flex items-center justify-center relative transition-colors',
            activePanel === item.id ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          )}
          data-tooltip={item.tooltip}
        >
          {activePanel === item.id && (
            <div
              className={clsx(
                'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 bg-white',
                sidebarCollapsed ? 'h-4 opacity-90' : 'h-6'
              )}
            />
          )}
          {item.icon}
        </button>
      ))}

      <div className="flex-1" />

      <button
        onClick={openKeyboardShortcutsModal}
        className="w-12 h-12 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
        data-tooltip="Open the keyboard shortcuts cheat sheet (⌘+?)."
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      <button
        onClick={toggleSettings}
        className="w-12 h-12 flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
        data-tooltip="Open Orca settings and preferences."
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  )
}
