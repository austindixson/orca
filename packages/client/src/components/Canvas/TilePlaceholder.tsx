/**
 * Lightweight placeholder UI rendered inside tile chrome during workspace rebuild.
 * Shows tile type, status ("Queued" / "Activating..." / "Paused"), and an Activate button.
 */

import { type TileData, type TileType } from '../../store/canvasStore'
import { useWorkspaceRebuildStore } from '../../store/workspaceRebuildStore'
import { activateTileManually } from '../../lib/workspaceRebuilder'
import { isHeavyTile } from '../../lib/tileLoadProfile'

interface TilePlaceholderProps {
  data: TileData
}

const TILE_TYPE_LABELS: Partial<Record<TileType, string>> = {
  terminal: 'Terminal',
  editor: 'Editor',
  browser: 'Browser',
  github: 'GitHub',
  diff: 'Diff',
  todo: 'Todo',
  agent: 'Agent',
  agent_team: 'Agent Team',
  changelog: 'Changelog',
  orchestrator: 'Orchestrator',
  benchmark: 'Benchmark',
  remotion: 'Remotion',
  openrouter_usage: 'OpenRouter Usage',
  toolbox: 'Toolbox',
  research: 'Research',
  reasoning: 'Reasoning',
  project_status: 'Project Status',
  telemetry: 'Telemetry',
  hermes_bridge: 'Hermes Bridge',
  hermes_agent: 'Hermes Agent',
  telegram_onboard: 'Telegram',
  native_gateway: 'Native Gateway',
  bug_bounty: 'Bug Bounty',
}

export function TilePlaceholder({ data }: TilePlaceholderProps) {
  const { phase, currentTileId, queue, parkedHeavyIds } = useWorkspaceRebuildStore()

  const isActivating = currentTileId === data.id
  const isInQueue = queue.includes(data.id)
  const isParked = parkedHeavyIds.includes(data.id)
  const isHeavy = isHeavyTile(data.type)

  let statusText: string
  let statusColor: string

  if (isActivating) {
    statusText = 'Activating...'
    statusColor = 'text-blue-400'
  } else if (isParked) {
    statusText = 'Paused'
    statusColor = 'text-amber-400'
  } else if (isInQueue) {
    const position = queue.indexOf(data.id) + 1
    statusText = `Queued (#${position})`
    statusColor = 'text-gray-400'
  } else if (phase === 'paused') {
    statusText = 'Paused'
    statusColor = 'text-amber-400'
  } else {
    statusText = 'Pending'
    statusColor = 'text-gray-500'
  }

  const canActivateNow = !isActivating && (isParked || phase === 'paused' || phase === 'safe')

  const handleActivate = async () => {
    await activateTileManually(data.id)
  }

  const typeLabel = TILE_TYPE_LABELS[data.type] ?? data.type

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas-bg/50 p-4">
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium text-gray-300">
          {typeLabel}
        </span>
        <span className={`text-xs font-medium ${statusColor}`}>
          {statusText}
        </span>
      </div>

      {isActivating && (
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 animate-spin text-blue-400"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-xs text-blue-300">Loading...</span>
        </div>
      )}

      {canActivateNow && (
        <button
          type="button"
          onClick={handleActivate}
          className="rounded-md border border-blue-500/40 bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-600/30 hover:text-blue-200"
        >
          Activate now
        </button>
      )}

      {isHeavy && !isActivating && !canActivateNow && (
        <span className="text-[10px] text-gray-500">
          Heavy tile — waiting for scheduler
        </span>
      )}
    </div>
  )
}
