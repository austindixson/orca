import { useState, useEffect, useMemo } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useCanvasStore } from '../../store/canvasStore'
import { useSettingsStore } from '../../store/settingsStore'
import { writeFile } from '../../lib/tauri'
import { useTileMountAck } from '../../hooks/useTileMountAck'

const DEFAULT_STUDIO = 'http://localhost:3000'
const REMOTION_DOCS = 'https://www.remotion.dev/docs'
const REMOTION_REPO = 'https://github.com/remotion-dev/remotion'
const DEFAULT_OUTPUT_FILE = 'agent-canvas-demo.mp4'
const DEFAULT_COMPOSITION = 'Main'

function initialStudioUrl(meta: Record<string, unknown> | undefined): string {
  const u = meta?.studioUrl ?? meta?.url
  return typeof u === 'string' && u.trim() ? u.trim() : DEFAULT_STUDIO
}

function normalizeRelativeDir(dir: string): string {
  return dir.replace(/^\/+/, '').trim().replace(/\/+$/, '') || 'videos/remotion'
}

function sanitizeOutputName(name: string): string {
  const base = name.trim().replace(/[/\\]+/g, '-').replace(/\s+/g, '-')
  const withExt = base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`
  return withExt || DEFAULT_OUTPUT_FILE
}

function shQ(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`
}

/**
 * Remotion “generator” surface: iframe to local Studio (when running) plus docs links.
 * Remotion itself is a React/Node toolchain ([remotion](https://github.com/remotion-dev/remotion)) — render videos with `npx remotion` in the workspace terminal.
 */
export function RemotionTile({ data }: TileComponentProps) {
  useTileMountAck(data.id, true)
  const [url, setUrl] = useState(() => initialStudioUrl(data.meta))
  const [input, setInput] = useState(() => initialStudioUrl(data.meta))
  const [compositionName, setCompositionName] = useState(DEFAULT_COMPOSITION)
  const [outputName, setOutputName] = useState(DEFAULT_OUTPUT_FILE)
  const [prompt, setPrompt] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const addTile = useCanvasStore((s) => s.addTile)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const remotionOutputDir = useSettingsStore((s) => s.remotionOutputDir)

  useEffect(() => {
    const u = initialStudioUrl(data.meta)
    setUrl(u)
    setInput(u)
  }, [data.meta])

  const outputDir = normalizeRelativeDir(remotionOutputDir)
  const safeOutputName = sanitizeOutputName(outputName)
  const outputPath = `${outputDir}/${safeOutputName}`
  const renderCommand = useMemo(
    () =>
      `mkdir -p ${shQ(outputDir)} && npx remotion render src/index.tsx ${shQ(
        compositionName.trim() || DEFAULT_COMPOSITION
      )} ${shQ(outputPath)}`,
    [compositionName, outputDir, outputPath]
  )

  const openTerminalWithCommand = (title: string, command: string) => {
    const terminalId = addTile('terminal')
    updateTile(terminalId, {
      title,
      meta: { command },
    })
  }

  const saveBrief = async () => {
    setBusy(true)
    setNote(null)
    try {
      const content = `# Remotion render brief

## Prompt
${prompt.trim() || '(no prompt provided)'}

## Output
- Directory: \`${outputDir}\`
- File: \`${safeOutputName}\`
- Composition: \`${compositionName.trim() || DEFAULT_COMPOSITION}\`

## Command
\`\`\`bash
${renderCommand}
\`\`\`
`
      await writeFile('.agent-canvas/remotion/render-brief.md', content)
      setNote('Saved .agent-canvas/remotion/render-brief.md')
    } catch (e) {
      setNote(`Failed to save brief: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="shrink-0 space-y-2 border-b border-tile-border px-3 py-2">
        <p className="text-[11px] text-gray-500">
          <a href={REMOTION_DOCS} target="_blank" rel="noreferrer" className="text-accent-teal hover:underline">
            Remotion docs
          </a>
          <span className="text-gray-600"> · </span>
          <a href={REMOTION_REPO} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-accent-teal">
            GitHub remotion-dev/remotion
          </a>
        </p>
        <div className="rounded-md border border-fuchsia-400/25 bg-fuchsia-500/10 p-2 text-[11px] text-fuchsia-100/90">
          Default output folder from Settings: <code className="rounded bg-black/35 px-1">{outputDir}</code>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[56px] w-full rounded border border-tile-border bg-black/25 px-2 py-1 text-xs text-gray-100"
          placeholder="Describe the video you want rendered..."
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            value={compositionName}
            onChange={(e) => setCompositionName(e.target.value)}
            className="rounded border border-tile-border bg-black/25 px-2 py-1 text-xs text-gray-100"
            placeholder="Composition (e.g. Main)"
          />
          <input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            className="rounded border border-tile-border bg-black/25 px-2 py-1 text-xs text-gray-100"
            placeholder="Output file (e.g. demo.mp4)"
          />
        </div>
        <p className="text-[11px] text-gray-400">
          Render path: <code className="rounded bg-black/35 px-1">{outputPath}</code>
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => openTerminalWithCommand('Remotion studio', 'npx remotion studio')}
            className="rounded border border-accent-teal/50 bg-accent-teal/15 px-2 py-1 text-[11px] text-accent-teal"
          >
            Start Studio
          </button>
          <button
            type="button"
            onClick={() => openTerminalWithCommand('Remotion render', renderCommand)}
            className="rounded border border-fuchsia-400/50 bg-fuchsia-500/15 px-2 py-1 text-[11px] text-fuchsia-200"
          >
            Render Video
          </button>
          <button
            type="button"
            onClick={saveBrief}
            disabled={busy}
            className="rounded border border-tile-border/80 bg-black/20 px-2 py-1 text-[11px] text-gray-300 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save brief'}
          </button>
        </div>
        {note && <p className="text-[11px] text-gray-400">{note}</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            let next = input.trim()
            if (next && !next.startsWith('http://') && !next.startsWith('https://')) {
              next = 'https://' + next
            }
            setUrl(next || DEFAULT_STUDIO)
            setInput(next || DEFAULT_STUDIO)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-w-0 flex-1 rounded border border-tile-border bg-black/25 px-2 py-1 text-xs text-gray-100"
            placeholder="http://localhost:3000"
          />
          <button
            type="submit"
            className="shrink-0 rounded border border-accent-teal/50 bg-accent-teal/15 px-2 py-1 text-[11px] text-accent-teal"
          >
            Load
          </button>
        </form>
      </div>
      <div className="relative flex-1 min-h-0 bg-black/20">
        {url ? (
          <iframe title="Remotion Studio" src={url} className="h-full w-full border-0" />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-sm text-gray-500">Enter a Studio URL</div>
        )}
      </div>
    </div>
  )
}
