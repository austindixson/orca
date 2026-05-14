import { useEffect, useMemo, useRef, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useCanvasStore } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { useTileMountAck } from '../../hooks/useTileMountAck'
import * as tauri from '../../lib/tauri'
import { normalizeBrowserTileInputUrl, normalizeLoopbackUrlForShell } from '../../lib/browserTileUrl'

type PreviewState = 'closed' | 'loading' | 'open' | 'error'

function readTileUrl(meta: Record<string, unknown> | undefined): string {
  const fromUrl = typeof meta?.url === 'string' ? meta.url.trim() : ''
  if (fromUrl) return fromUrl
  const fromInitial = typeof meta?.initialUrl === 'string' ? meta.initialUrl.trim() : ''
  if (fromInitial) return fromInitial
  return ''
}

export function BrowserTile({ data }: TileComponentProps) {
  const ackMount = useTileMountAck(data.id)
  const updateTile = useCanvasStore((s) => s.updateTile)
  const [url, setUrl] = useState(() => readTileUrl(data.meta))
  const [inputUrl, setInputUrl] = useState(() => readTileUrl(data.meta))
  const [previewState, setPreviewState] = useState<PreviewState>('closed')
  const [lastError, setLastError] = useState<string | null>(null)
  const [renderMode, setRenderMode] = useState<'tile' | 'native'>('tile')
  const destroyListenerRef = useRef<(() => void) | null>(null)
  const fallbackAttemptedUrlRef = useRef<string | null>(null)

  const toast = useToastStore((s) => s.addToast)

  const title = useMemo(() => {
    const trimmed = typeof data.title === 'string' ? data.title.trim() : ''
    return trimmed || 'Browser'
  }, [data.title])

  useEffect(() => {
    ackMount()
  }, [ackMount])

  useEffect(() => {
    const nextUrl = readTileUrl(data.meta)
    setUrl(nextUrl)
    setInputUrl(nextUrl)
  }, [data.meta])

  useEffect(
    () => () => {
      if (destroyListenerRef.current) {
        destroyListenerRef.current()
        destroyListenerRef.current = null
      }
    },
    []
  )

  useEffect(() => {
    if (!tauri.isTauri()) return
    if (renderMode !== 'native') return
    if (!url) return
    void tauri.navigateBrowserPreview(data.id, url).catch(() => {
      // Window may not be open yet; handleOpen() opens it.
    })
  }, [data.id, renderMode, url])

  const persistUrlMeta = (nextUrl: string): void => {
    const trimmed = nextUrl.trim()
    if (!trimmed) return
    const currentMeta = (data.meta ?? {}) as Record<string, unknown>
    updateTile(data.id, {
      meta: {
        ...currentMeta,
        url: trimmed,
      },
    })
  }

  const showError = (message: string): void => {
    setPreviewState('error')
    setLastError(message)
    toast({
      type: 'error',
      title: 'Browser preview error',
      message,
      duration: 5000,
    })
  }

  const openNativePreview = async (nextUrl: string): Promise<void> => {
    if (!tauri.isTauri()) {
      await tauri.openExternalUrl(nextUrl)
      return
    }
    await tauri.openBrowserPreviewWindow({ tileId: data.id, url: nextUrl, title })
    if (destroyListenerRef.current) {
      destroyListenerRef.current()
      destroyListenerRef.current = null
    }
    destroyListenerRef.current = await tauri.onBrowserPreviewDestroyed(data.id, () => {
      if (renderMode === 'native') {
        setPreviewState('closed')
      }
    })
  }

  const isLoopbackPreviewUrl = (candidate: string): boolean => {
    try {
      const u = new URL(candidate)
      const host = u.hostname.toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    } catch {
      return false
    }
  }

  const handleOpen = async (): Promise<void> => {
    const normalized = normalizeBrowserTileInputUrl(inputUrl)
    if (!normalized) {
      showError('Enter a URL first.')
      return
    }
    const inTileUrl = normalizeLoopbackUrlForShell(normalized)
    const preferredMode: 'tile' | 'native' =
      tauri.isTauri() && !isLoopbackPreviewUrl(inTileUrl) ? 'native' : 'tile'
    setRenderMode(preferredMode)
    setPreviewState('loading')
    setLastError(null)
    setUrl(inTileUrl)
    setInputUrl(inTileUrl)
    persistUrlMeta(inTileUrl)
    if (preferredMode === 'native') {
      try {
        await openNativePreview(inTileUrl)
        setPreviewState('open')
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * Some sites silently white-screen in iframes (X-Frame-Options/CSP). If in-tile loading stalls,
   * auto-fallback to native Orca preview in desktop mode.
   */
  useEffect(() => {
    if (!tauri.isTauri()) return
    if (renderMode !== 'tile') return
    if (previewState !== 'loading') return
    if (!url) return
    if (fallbackAttemptedUrlRef.current === url) return

    const timer = window.setTimeout(() => {
      fallbackAttemptedUrlRef.current = url
      setRenderMode('native')
      setLastError('This site likely blocks iframe embedding. Switched to Orca window mode.')
      toast({
        type: 'info',
        title: 'Browser preview fallback',
        message: 'This site blocks in-tile embedding. Opened in Orca window mode.',
        duration: 3500,
      })
      void openNativePreview(url)
        .then(() => setPreviewState('open'))
        .catch((error) => showError(error instanceof Error ? error.message : String(error)))
    }, 2200)

    return () => window.clearTimeout(timer)
  }, [openNativePreview, previewState, renderMode, toast, url])

  const handleClose = (): void => {
    if (tauri.isTauri()) {
      void tauri.closeBrowserPreview(data.id).catch(() => {
        // Ignore if preview window is already closed.
      })
    }
    setPreviewState('closed')
    setLastError(null)
    setUrl('')
  }

  const handleOpenExternal = async (): Promise<void> => {
    const trimmed = url.trim()
    if (!trimmed) return
    try {
      await tauri.openExternalUrl(trimmed)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#1a1a1a] text-white">
      <div className="px-3 py-2 border-b border-tile-border/60 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleOpen()
              }
            }}
            className="flex-1 rounded bg-black/35 border border-tile-border px-2 py-1 text-xs font-mono"
            placeholder="https://… or http://localhost:PORT"
          />
          <button
            type="button"
            onClick={() => void handleOpen()}
            className="px-2 py-1 rounded bg-accent-teal/25 text-accent-teal text-xs hover:bg-accent-teal/35"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => void handleOpenExternal()}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20"
            disabled={!url}
          >
            Open external
          </button>
          <button
            type="button"
            onClick={async () => {
              setRenderMode('native')
              const target = url || normalizeLoopbackUrlForShell(normalizeBrowserTileInputUrl(inputUrl))
              if (!target) {
                showError('Enter a URL first.')
                return
              }
              setUrl(target)
              setInputUrl(target)
              persistUrlMeta(target)
              setPreviewState('loading')
              setLastError(null)
              try {
                await openNativePreview(target)
                setPreviewState('open')
              } catch (error) {
                showError(error instanceof Error ? error.message : String(error))
              }
            }}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20"
          >
            Orca window mode
          </button>
          <button
            type="button"
            onClick={() => {
              setRenderMode('tile')
              if (url) {
                setPreviewState('loading')
                setLastError(null)
              }
            }}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20"
          >
            In-tile mode
          </button>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20"
            disabled={!url}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 text-sm text-gray-300 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">Status:</span>
          <span
            className={
              previewState === 'open'
                ? 'text-emerald-300'
                : previewState === 'loading'
                  ? 'text-amber-300'
                  : previewState === 'error'
                    ? 'text-rose-300'
                    : 'text-gray-400'
            }
          >
            {previewState} · {renderMode === 'tile' ? 'in-tile' : 'orca-window'}
          </span>
        </div>

        <p>
          In-tile uses an iframe, some sites block this by policy. Use Orca window mode for compatibility.
        </p>

        {lastError && (
          <p className="text-rose-300 text-xs border border-rose-500/40 rounded px-2 py-1 bg-rose-950/20">
            {lastError}
          </p>
        )}

        <p className="text-xs text-gray-500 break-all">
          Active URL:{' '}
          <span className="font-mono">{url || '(none — enter a URL and click Open)'}</span>
        </p>

        {url && renderMode === 'tile' ? (
          <div className="h-[calc(100%-6.5rem)] min-h-[220px] overflow-hidden rounded border border-tile-border/70 bg-black/20">
            <iframe
              key={url}
              src={url}
              title={title}
              className="h-full w-full border-0 bg-white"
              onLoad={() => {
                setPreviewState('open')
                setLastError(null)
              }}
              onError={() => {
                showError('Failed to render this page in the tile. Try Open external.')
              }}
            />
          </div>
        ) : null}
        {url && renderMode === 'native' && (
          <div className="rounded border border-tile-border/70 bg-black/20 p-3 text-xs text-gray-400">
            Rendering in Orca native preview window for maximum site compatibility.
          </div>
        )}
      </div>
    </div>
  )
}
