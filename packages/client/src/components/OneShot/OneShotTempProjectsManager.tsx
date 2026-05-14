import { useCallback, useEffect, useState } from 'react'
import * as tauri from '../../lib/tauri'
import { useToastStore } from '../../store/toastStore'

/**
 * Lists leftover 1-shot folders under the OS temp directory and can open that folder or delete all matching projects.
 */
export function OneShotTempProjectsManager() {
  const addToast = useToastStore((s) => s.addToast)
  const [root, setRoot] = useState<string | null>(null)
  const [paths, setPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const desktop = tauri.isTauri()

  const refresh = useCallback(async () => {
    if (!desktop) return
    setLoading(true)
    try {
      const [r, list] = await Promise.all([tauri.oneshotTempRootPath(), tauri.listOneshotTempProjects()])
      setRoot(r)
      setPaths(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      addToast({ type: 'error', title: 'Temp scan failed', message: msg.slice(0, 160) })
    } finally {
      setLoading(false)
    }
  }, [addToast, desktop])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!desktop) {
    return (
      <p className="text-[10px] text-gray-600">
        Temp cleanup is available in the desktop app (1-shot disposable folders live under the system temp directory).
      </p>
    )
  }

  return (
    <details className="group rounded-lg border border-tile-border/55 bg-black/15 font-mono text-[10px] text-gray-500">
      <summary className="cursor-pointer list-none px-2 py-1.5 text-[10px] text-gray-400 marker:content-none hover:text-gray-200 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded border border-tile-border/60 bg-black/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-gray-500">
            1-shot temp
          </span>
          <span>{paths.length} folder{paths.length === 1 ? '' : 's'}</span>
          <span className="text-gray-600">· cleanup</span>
        </span>
      </summary>
      <div className="space-y-2 border-t border-tile-border/40 px-2 py-2">
        {root && (
          <p className="break-all text-[9px] leading-tight text-gray-600">
            <span className="text-gray-500">Temp root:</span> {root}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/5"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Scanning…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded border border-tile-border/70 bg-black/25 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/5"
            onClick={() => void tauri.openOneshotTempInFileManager()}
          >
            Open temp in Finder / Explorer
          </button>
          <button
            type="button"
            className="rounded border border-rose-400/35 bg-rose-950/30 px-2 py-1 text-[10px] text-rose-200/90 hover:bg-rose-900/40"
            onClick={async () => {
              if (paths.length === 0) {
                addToast({ type: 'info', title: '1-shot temp', message: 'Nothing to delete.' })
                return
              }
              if (!window.confirm(`Delete all ${paths.length} leftover 1-shot folder(s) under the OS temp directory?`)) {
                return
              }
              try {
                const n = await tauri.deleteAllOneshotTempProjects()
                addToast({
                  type: 'success',
                  title: 'Temp cleaned',
                  message: `Removed ${n} folder${n === 1 ? '' : 's'}.`,
                })
                void refresh()
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                addToast({ type: 'error', title: 'Delete failed', message: msg.slice(0, 180) })
              }
            }}
          >
            Delete all listed
          </button>
        </div>
        {paths.length > 0 ? (
          <ul className="max-h-28 overflow-y-auto space-y-0.5 text-[9px] text-gray-600">
            {paths.map((p) => (
              <li key={p} className="break-all">
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-gray-600">No `agent-canvas-oneshot-*` folders found right now.</p>
        )}
      </div>
    </details>
  )
}
