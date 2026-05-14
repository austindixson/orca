import { useEffect, useState } from 'react'
import * as tauri from '../../lib/tauri'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useOneShotStore, type OneShotWorkspaceChoice } from '../../store/oneShotStore'

type PickerStep = { kind: 'main' } | { kind: 'nameFolder'; parentPath: string }

/**
 * Shown before a 1-shot run: where to run the pipeline (temp, current folder, pick/open, or new folder).
 */
export function OneShotWorkspacePickerModal() {
  const open = useOneShotStore((s) => s.workspacePickerOpen)
  const close = useOneShotStore((s) => s.closeWorkspacePicker)
  const rootPath = useWorkspaceStore((s) => s.rootPath)

  const [step, setStep] = useState<PickerStep>({ kind: 'main' })
  const [folderName, setFolderName] = useState('')

  useEffect(() => {
    if (open) {
      setStep({ kind: 'main' })
      setFolderName('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const canUseCurrent =
    tauri.isTauri() ? rootPath != null && rootPath !== '.' : true

  const pickMain = async (choice: OneShotWorkspaceChoice) => {
    close(choice)
  }

  const onOpenFolder = async () => {
    if (!tauri.isTauri()) return
    const picked = await tauri.openFolderDialog()
    if (picked) await pickMain({ kind: 'opened', path: picked.path })
  }

  const onNewParentPicked = async () => {
    if (!tauri.isTauri()) return
    const picked = await tauri.openFolderDialog()
    if (picked) setStep({ kind: 'nameFolder', parentPath: picked.path })
  }

  const confirmNewFolder = () => {
    const name = folderName.trim()
    if (!name) return
    if (step.kind !== 'nameFolder') return
    close({ kind: 'new', parentPath: step.parentPath, folderName: name })
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/45 p-4">
      <div
        className="w-full max-w-md rounded-lg border border-tile-border bg-canvas-bg/95 p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oneshot-ws-title"
      >
        <h2 id="oneshot-ws-title" className="text-sm font-semibold text-gray-100">
          1-shot workspace
        </h2>
        <p className="mt-1 text-[11px] leading-snug text-gray-500">
          Choose where generated files and the pipeline run. Disposable OS temp folders are removed when you discard,
          unless you save elsewhere first.
        </p>

        {step.kind === 'main' && (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-md border border-tile-border/80 bg-black/25 px-3 py-2 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/5"
              onClick={() => void pickMain({ kind: 'temp' })}
            >
              <span className="font-medium text-accent-teal">OS temp directory</span>
              <span className="mt-0.5 block text-[10px] text-gray-500">Safest default — isolated, can be discarded.</span>
            </button>
            <button
              type="button"
              disabled={!canUseCurrent}
              className={`rounded-md border border-tile-border/80 px-3 py-2 text-left text-[12px] transition-colors ${
                canUseCurrent
                  ? 'bg-black/25 text-gray-200 hover:bg-white/5'
                  : 'cursor-not-allowed opacity-50'
              }`}
              onClick={() => void pickMain({ kind: 'current' })}
              data-tooltip={!canUseCurrent ? 'Open a folder first (File → Open folder)' : undefined}
            >
              <span className="font-medium text-gray-100">Current workspace folder</span>
              <span className="mt-0.5 block text-[10px] text-gray-500">Write directly into the project you already have open.</span>
            </button>
            {tauri.isTauri() && (
              <>
                <button
                  type="button"
                  className="rounded-md border border-tile-border/80 bg-black/25 px-3 py-2 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/5"
                  onClick={() => void onOpenFolder()}
                >
                  <span className="font-medium text-gray-100">Open existing folder…</span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">Switch workspace for this run.</span>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-tile-border/80 bg-black/25 px-3 py-2 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/5"
                  onClick={() => void onNewParentPicked()}
                >
                  <span className="font-medium text-gray-100">New folder in…</span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">Pick a parent, then name the new project folder.</span>
                </button>
              </>
            )}
            {!tauri.isTauri() && (
              <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-200/90">
                Open/pick/new folder needs the desktop app. In the browser, use temp or the current workspace.
              </p>
            )}
            <button
              type="button"
              className="mt-1 rounded-md border border-tile-border/60 px-3 py-1.5 text-[11px] text-gray-500 hover:bg-white/5"
              onClick={() => close(null)}
            >
              Cancel
            </button>
          </div>
        )}

        {step.kind === 'nameFolder' && (
          <div className="mt-4 space-y-3">
            <p className="text-[11px] text-gray-400">
              Parent: <span className="break-all font-mono text-[10px] text-gray-500">{step.parentPath}</span>
            </p>
            <label className="block text-[11px] text-gray-500">
              New folder name
              <input
                className="mt-1 w-full rounded-md border border-tile-border/80 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-gray-200"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="my-project"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmNewFolder()
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-accent-teal/40 bg-accent-teal/15 px-3 py-1.5 text-[11px] font-medium text-accent-teal"
                onClick={confirmNewFolder}
              >
                Create & use
              </button>
              <button
                type="button"
                className="rounded-md border border-tile-border/60 px-3 py-1.5 text-[11px] text-gray-400 hover:bg-white/5"
                onClick={() => setStep({ kind: 'main' })}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
