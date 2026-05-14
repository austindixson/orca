/**
 * Progress banner shown during workspace rebuild.
 * Displays progress, pause/resume controls, and Safe Mode options.
 */

import { useWorkspaceRebuildStore } from '../../store/workspaceRebuildStore'
import { isHeavyTile } from '../../lib/tileLoadProfile'
import { useCanvasStore } from '../../store/canvasStore'

export function WorkspaceRebuildBanner() {
  const {
    phase,
    mode,
    total,
    completed,
    queue,
    parkedHeavyIds,
    pause,
    resume,
    enterSafeMode,
    activateAllNow,
  } = useWorkspaceRebuildStore()

  const tiles = useCanvasStore((s) => s.tiles)

  if (phase === 'idle' || phase === 'done') {
    return null
  }

  const heavyInQueue = queue.filter((id) => {
    const tile = tiles.get(id)
    return tile && isHeavyTile(tile.type)
  }).length

  const isPaused = phase === 'paused'
  const isSafe = phase === 'safe' || mode === 'safe'
  const isRunning = phase === 'running' || phase === 'queued'

  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="fixed left-1/2 top-8 z-[300] -translate-x-1/2 transform">
      <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-[#1e1e2e]/95 px-4 py-2 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2">
          {isRunning && (
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
          )}
          {isPaused && (
            <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          )}
          <span className="text-sm text-gray-200">
            Rebuilding workspace
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{completed}/{total} tiles</span>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {(heavyInQueue > 0 || parkedHeavyIds.length > 0) && (
          <span className="text-xs text-amber-400/80">
            {parkedHeavyIds.length > 0
              ? `${parkedHeavyIds.length} heavy paused`
              : `${heavyInQueue} heavy queued`}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              type="button"
              onClick={pause}
              className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-700"
            >
              Pause
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              onClick={resume}
              className="rounded border border-blue-500/50 bg-blue-600/20 px-2 py-0.5 text-xs text-blue-300 transition-colors hover:bg-blue-600/30"
            >
              Resume
            </button>
          )}

          {!isSafe && (isRunning || isPaused) && heavyInQueue > 0 && (
            <button
              type="button"
              onClick={enterSafeMode}
              className="rounded border border-amber-500/40 px-2 py-0.5 text-xs text-amber-300 transition-colors hover:bg-amber-600/20"
              data-tooltip="Stop auto-loading heavy tiles; click each to activate manually"
            >
              Safe Mode
            </button>
          )}

          <button
            type="button"
            onClick={activateAllNow}
            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
            data-tooltip="Immediately activate all remaining tiles (may cause lag)"
          >
            Activate all
          </button>
        </div>
      </div>
    </div>
  )
}
