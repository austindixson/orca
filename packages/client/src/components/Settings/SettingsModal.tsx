import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import { useToastStore } from '../../store/toastStore'
import { createEmptyShowKey } from './settingsShowKey'
import { ModelsSection } from './sections/ModelsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { CanvasSection } from './sections/CanvasSection'
import { AgentDataSection } from './sections/AgentDataSection'
import { IntegrationsSection } from './sections/IntegrationsSection'
import type { SettingsSectionId } from '../../store/settingsStore'

const NAV_ITEMS: { id: SettingsSectionId; label: string; hint: string }[] = [
  { id: 'models', label: 'Models & APIs', hint: 'Keys, models, Hermes mode' },
  { id: 'appearance', label: 'Look & motion', hint: 'Theme, colors, animation' },
  { id: 'canvas', label: 'Workspace', hint: 'Tiles, layout, output' },
  { id: 'agent', label: 'Agent & memory', hint: 'Sessions, vault, harness' },
  { id: 'integrations', label: 'Connections', hint: 'Hermes, Telegram, bridge' },
]

export function SettingsModal() {
  const showSettings = useSettingsStore((s) => s.showSettings)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)
  const settingsSection = useSettingsStore((s) => s.settingsSection)
  const setSettingsSection = useSettingsStore((s) => s.setSettingsSection)
  const providers = useSettingsStore((s) => s.providers)
  const fetchOllamaModels = useSettingsStore((s) => s.fetchOllamaModels)
  const fetchLlamaCppModels = useSettingsStore((s) => s.fetchLlamaCppModels)

  const [showKey, setShowKey] = useState(createEmptyShowKey)
  const [localModelsBusy, setLocalModelsBusy] = useState(false)

  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (showSettings && providers.ollama.enabled) {
      fetchOllamaModels()
    }
  }, [showSettings, providers.ollama.enabled, fetchOllamaModels])

  useEffect(() => {
    if (showSettings && providers.llamacpp.enabled) {
      fetchLlamaCppModels()
    }
  }, [showSettings, providers.llamacpp.enabled, fetchLlamaCppModels])

  const runLocalModelFetch = async (which: 'both' | 'ollama' | 'llamacpp') => {
    setLocalModelsBusy(true)
    try {
      if (which === 'both') {
        if (providers.ollama.enabled) await fetchOllamaModels()
        if (providers.llamacpp.enabled) await fetchLlamaCppModels()
      } else if (which === 'ollama') {
        await fetchOllamaModels()
      } else {
        await fetchLlamaCppModels()
      }
    } finally {
      setLocalModelsBusy(false)
    }
  }

  const handleSave = async () => {
    if (providers.ollama.enabled || providers.llamacpp.enabled) {
      await runLocalModelFetch('both')
    }
    addToast({
      type: 'success',
      title: 'Settings saved',
      message: 'Your API keys are stored locally in your browser',
    })
    toggleSettings()
  }

  if (!showSettings) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
        onClick={toggleSettings}
        aria-hidden
      />
      <div
        className="settings-modal-root fixed left-1/2 top-1/2 z-[101] flex max-h-[88vh] w-[min(960px,calc(100vw-1.25rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-tile-border bg-tile-bg shadow-2xl motion-safe:transition-[opacity,transform] motion-safe:duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-tile-border px-5 py-3">
          <h2 id="settings-modal-title" className="text-base font-semibold text-gray-100">
            Settings
          </h2>
          <button
            type="button"
            onClick={toggleSettings}
            className="rounded-lg p-1 text-gray-500 outline-none ring-accent-teal/40 transition-colors hover:text-white focus-visible:ring-2"
            aria-label="Close settings"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(220px,260px)_1fr]">
          <nav
            className="border-b border-tile-border bg-black/20 md:border-b-0 md:border-r md:border-tile-border"
            aria-label="Settings sections"
          >
            <div className="p-3 md:block">
              <label className="mb-2 block text-xs font-medium text-gray-500 md:hidden">
                Section
              </label>
              <select
                value={settingsSection}
                onChange={(e) => setSettingsSection(e.target.value as SettingsSectionId)}
                className="mb-2 w-full rounded-lg border border-tile-border bg-canvas-bg px-3 py-2 text-sm text-gray-200 outline-none ring-accent-teal/40 focus:border-accent-teal/50 focus-visible:ring-2 md:hidden"
              >
                {NAV_ITEMS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <ul className="hidden flex-col gap-1 md:flex">
                {NAV_ITEMS.map((item) => {
                  const active = settingsSection === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSettingsSection(item.id)}
                        className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm outline-none ring-accent-teal/40 transition-colors focus-visible:ring-2 ${
                          active
                            ? 'bg-accent-teal/15 text-accent-teal'
                            : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                      >
                        <span className="font-medium">{item.label}</span>
                        <span className="text-xs text-gray-500">{item.hint}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </nav>

          <div className="min-h-0 overflow-auto px-5 py-4 md:px-6">
            {settingsSection === 'models' && (
              <ModelsSection
                showKey={showKey}
                setShowKey={setShowKey}
                localModelsBusy={localModelsBusy}
                runLocalModelFetch={runLocalModelFetch}
              />
            )}
            {settingsSection === 'appearance' && <AppearanceSection />}
            {settingsSection === 'canvas' && <CanvasSection />}
            {settingsSection === 'agent' && (
              <AgentDataSection prefillHarnessSession={showSettings && settingsSection === 'agent'} />
            )}
            {settingsSection === 'integrations' && <IntegrationsSection />}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-tile-border bg-canvas-bg px-5 py-3">
          <div className="text-xs text-gray-600">
            <svg className="mr-1 inline h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Stored locally in browser
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleSettings}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={localModelsBusy}
              className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-canvas-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {localModelsBusy ? 'Refreshing…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
