import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useIntegrationWizardStore } from '../../store/integrationWizardStore'
import { useCanvasStore } from '../../store/canvasStore'
import { useToastStore } from '../../store/toastStore'
import { INTEGRATION_CATALOG, type IntegrationEntry, type IntegrationId } from '../../lib/integrations/integrationCatalog'
import { CURATED_SKILL_SOURCES_MARKDOWN, INTEGRATION_DOC_MARKDOWN } from '../../lib/integrations/integrationDocs'
import { runObsidianIntegrationOneClick } from '../../lib/integrations/obsidianOneClick'
import { OrchestratorMarkdown } from '../orchestrator/OrchestratorMarkdown'
import * as tauri from '../../lib/tauri'

type WizardMainView = 'browse' | 'skill-sources'

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

export function IntegrationWizardModal() {
  const open = useIntegrationWizardStore((s) => s.open)
  const setOpen = useIntegrationWizardStore((s) => s.setOpen)
  const addTile = useCanvasStore((s) => s.addTile)
  const addToast = useToastStore((s) => s.addToast)

  const [mainView, setMainView] = useState<WizardMainView>('browse')
  const [selectedId, setSelectedId] = useState<IntegrationId>('gmail')
  const [search, setSearch] = useState('')
  const [urlById, setUrlById] = useState<Partial<Record<IntegrationId, string>>>({})

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return INTEGRATION_CATALOG
    return INTEGRATION_CATALOG.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.includes(q) ||
        e.keywords.some((k) => k.includes(q))
    )
  }, [search])

  const selected = useMemo(
    () => INTEGRATION_CATALOG.find((e) => e.id === selectedId) ?? INTEGRATION_CATALOG[0]!,
    [selectedId]
  )

  const docMarkdown = INTEGRATION_DOC_MARKDOWN[selected.id] ?? ''

  const effectiveUrl = useMemo(() => {
    const override = urlById[selected.id]?.trim()
    if (override) return normalizeUrl(override)
    if (selected.defaultUrl) return selected.defaultUrl
    return ''
  }, [selected, urlById])

  const close = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, close])

  useEffect(() => {
    if (open) setMainView('browse')
  }, [open])

  useEffect(() => {
    if (!open) return
    const id = useIntegrationWizardStore.getState().integrationIdToSelectOnOpen
    if (id) {
      useIntegrationWizardStore.setState({ integrationIdToSelectOnOpen: null })
      setSearch('')
      setSelectedId(id)
    }
  }, [open])

  useEffect(() => {
    if (filtered.some((e) => e.id === selectedId)) return
    setSelectedId(filtered[0]?.id ?? INTEGRATION_CATALOG[0]!.id)
  }, [filtered, selectedId])

  const handleAddBrowserTile = useCallback(
    (entry: IntegrationEntry, url: string) => {
      const u = normalizeUrl(url)
      if (!u) {
        addToast({ type: 'warning', title: 'URL required', message: 'Enter a URL or use the default.' })
        return
      }
      addTile('browser', undefined, {
        title: entry.label,
        meta: { url: u },
      })
      addToast({
        type: 'info',
        title: entry.label,
        message: 'Browser tile added. If the page is blank, the site may block iframes — use Open in default browser.',
      })
      close()
    },
    [addTile, addToast, close]
  )

  const handleOpenExternal = useCallback(
    async (url: string) => {
      const u = normalizeUrl(url)
      if (!u) return
      await tauri.openExternalUrl(u)
    },
    []
  )

  const onFocusObsidianBrain = useCallback(() => {
    void runObsidianIntegrationOneClick().then(() => close())
  }, [close])

  const handleAddTodoTile = useCallback(() => {
    addTile('todo')
    addToast({ type: 'info', title: 'Todo', message: 'Todo tile added to the canvas.' })
    close()
  }, [addTile, addToast, close])

  if (!open) return null

  const showBrowserActions =
    selected.kind === 'browser' || selected.kind === 'custom'

  return (
    <>
      <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm" onClick={close} aria-hidden />
      <div
        className="fixed left-1/2 top-1/2 z-[111] flex max-h-[85vh] w-[min(92vw,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-tile-border bg-tile-bg shadow-2xl"
        role="dialog"
        aria-labelledby="integration-wizard-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-tile-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="integration-wizard-title" className="text-lg font-semibold text-white">
              Integrations
            </h2>
            <div
              className="mt-2 flex flex-wrap gap-1"
              role="tablist"
              aria-label="Wizard section"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'browse'}
                onClick={() => setMainView('browse')}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mainView === 'browse'
                    ? 'bg-accent-teal/25 text-accent-teal'
                    : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                )}
              >
                Browse
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'skill-sources'}
                onClick={() => setMainView('skill-sources')}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mainView === 'skill-sources'
                    ? 'bg-accent-teal/25 text-accent-teal'
                    : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
                )}
              >
                Skill sources
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 text-gray-500 transition-colors hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {mainView === 'skill-sources' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <OrchestratorMarkdown content={CURATED_SKILL_SOURCES_MARKDOWN} />
            </div>
            <div className="border-t border-tile-border px-4 py-2 text-[11px] text-gray-600">
              Source file in repo:{' '}
              <code className="text-gray-500">docs/skills/integrations/CURATED_SKILL_SOURCES.md</code>
            </div>
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
          <div className="flex w-full shrink-0 flex-col border-b border-tile-border sm:w-[13rem] sm:border-b-0 sm:border-r">
            <div className="p-2">
              <input
                type="search"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-tile-border bg-black/30 px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-accent-teal/50 focus:outline-none"
              />
            </div>
            <div className="max-h-[40vh] overflow-y-auto px-1 pb-2 sm:max-h-none sm:flex-1">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  className={clsx(
                    'mb-0.5 w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    selectedId === e.id
                      ? 'bg-accent-teal/20 text-white'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  )}
                >
                  {e.label}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-1 text-xs text-gray-500">No matches.</p>
              )}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-b border-tile-border px-4 py-2">
              <p className="text-sm text-gray-400">{selected.description}</p>
              {selected.blockedIframeLikely && (
                <p className="mt-2 text-xs text-amber-200/90">
                  Many sites block embedding in iframes. If the tile stays blank, use{' '}
                  <strong className="text-amber-100">Open in default browser</strong>.
                </p>
              )}
              {showBrowserActions && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-gray-500">
                    URL
                    <input
                      type="url"
                      value={urlById[selected.id] ?? ''}
                      placeholder={selected.defaultUrl ?? 'https://…'}
                      onChange={(e) =>
                        setUrlById((prev) => ({ ...prev, [selected.id]: e.target.value }))
                      }
                      className="rounded border border-tile-border bg-black/30 px-2 py-1 font-mono text-xs text-gray-100 focus:border-accent-teal/50 focus:outline-none"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <OrchestratorMarkdown content={docMarkdown} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-tile-border px-4 py-3">
              {showBrowserActions && (
                <>
                  <button
                    type="button"
                    onClick={() => handleAddBrowserTile(selected, effectiveUrl || selected.defaultUrl || '')}
                    className="rounded-lg bg-accent-teal/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-accent-teal"
                  >
                    Add browser tile
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOpenExternal(effectiveUrl || selected.defaultUrl || '')}
                    disabled={!effectiveUrl && !selected.defaultUrl}
                    className="rounded-lg border border-tile-border bg-black/30 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-40"
                  >
                    Open in default browser
                  </button>
                </>
              )}

              {selected.kind === 'sidebar' && selected.id === 'obsidian-brain' && (
                <button
                  type="button"
                  onClick={onFocusObsidianBrain}
                  className="rounded-lg bg-accent-teal/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-accent-teal"
                >
                  Open Obsidian brain
                </button>
              )}

              {selected.kind === 'todo' && (
                <button
                  type="button"
                  onClick={handleAddTodoTile}
                  className="rounded-lg bg-accent-teal/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-accent-teal"
                >
                  Add Todo tile
                </button>
              )}

              {selected.kind === 'obsidian' && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-xs text-gray-500">
                    Opens the Obsidian brain sidebar and scans wikilinks in your vault (current workspace folder).
                    Install kepano skills under <code className="text-gray-600">~/.claude/skills</code> for slash
                    workflows.
                  </p>
                  <button
                    type="button"
                    onClick={() => void runObsidianIntegrationOneClick().then(() => close())}
                    className="shrink-0 rounded-lg bg-accent-teal/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-accent-teal"
                  >
                    Add Obsidian
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {mainView === 'browse' && (
        <div className="border-t border-tile-border px-4 py-2 text-center text-[11px] text-gray-600">
          Repo docs: <code className="text-gray-500">docs/skills/integrations/</code>
          {' · '}
          <button
            type="button"
            onClick={() => setMainView('skill-sources')}
            className="text-accent-teal/90 hover:underline"
          >
            Curated skill matrix
          </button>
        </div>
        )}
      </div>
    </>
  )
}
