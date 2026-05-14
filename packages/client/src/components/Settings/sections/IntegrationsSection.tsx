import { openIntegrationWizardFromSettings } from '../../../lib/integrations/openIntegrationWizard'
import { runObsidianIntegrationOneClick } from '../../../lib/integrations/obsidianOneClick'
import { HermesApiSettingsPanel } from '../HermesApiSettingsPanel'
import { MessengerBridgeSetup } from '../MessengerBridgeSetup'
import { NativeTelegramSavedTokenPanel } from '../NativeTelegramSavedTokenPanel'
import { SettingsPageHeader } from '../settingsLayout'
import { SettingsSurface } from '../settingsPrimitives'

export function IntegrationsSection() {
  return (
    <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <SettingsPageHeader
        title="Connections"
        description="Hermes gateway, Telegram, Obsidian, and the canvas bridge for external agents. Keys stay on this device unless you sync them yourself."
      />

      <HermesApiSettingsPanel />

      <NativeTelegramSavedTokenPanel />

      <SettingsSurface>
        <h2 className="text-sm font-medium text-gray-200">Obsidian & skills</h2>
        <p className="mt-1 text-xs text-gray-500">
          Add Obsidian to the workspace or open the full wizard for skills, browser tiles, and more.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runObsidianIntegrationOneClick()}
            className="rounded-lg bg-accent-teal/90 px-4 py-2 text-sm font-medium text-black hover:bg-accent-teal"
          >
            Add Obsidian
          </button>
          <button
            type="button"
            onClick={() => openIntegrationWizardFromSettings()}
            className="rounded-lg border border-tile-border bg-black/25 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-white/5"
          >
            All integrations…
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Docs: <code className="rounded bg-black/35 px-1">docs/skills/integrations/</code>
        </p>
      </SettingsSurface>

      <details className="rounded-xl border border-tile-border bg-canvas-bg open:border-accent-teal/25">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-200 outline-none ring-accent-teal/40 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between">
            Skills & Obsidian notes
            <span className="text-gray-500">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </span>
          <p className="mt-1 text-xs font-normal text-gray-500">
            Skill sources and community packs live in the integration wizard.
          </p>
        </summary>
        <div className="border-t border-tile-border/80 px-4 pb-4 pt-2 text-xs text-gray-500">
          In the wizard, use the <strong className="text-gray-400">Skill sources</strong> tab. See{' '}
          <a
            href="https://github.com/kepano/obsidian-skills"
            target="_blank"
            rel="noreferrer"
            className="text-accent-teal hover:underline"
          >
            kepano/obsidian-skills
          </a>{' '}
          and local skills under <code className="text-gray-500">~/.claude/skills/</code>.
        </div>
      </details>

      <MessengerBridgeSetup />
    </div>
  )
}
