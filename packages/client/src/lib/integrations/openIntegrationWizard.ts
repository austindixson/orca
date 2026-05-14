import { useIntegrationWizardStore } from '../../store/integrationWizardStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { IntegrationId } from './integrationCatalog'

/** Open the integration wizard (e.g. title bar). Optionally pre-select an integration. */
export function openIntegrationWizard(options?: { integrationId?: IntegrationId }): void {
  useIntegrationWizardStore.setState({
    open: true,
    integrationIdToSelectOnOpen: options?.integrationId ?? null,
  })
}

/** Close Settings if open, then open the wizard (avoids stacked modals). */
export function openIntegrationWizardFromSettings(options?: { integrationId?: IntegrationId }): void {
  const { showSettings, toggleSettings } = useSettingsStore.getState()
  if (showSettings) toggleSettings()
  openIntegrationWizard(options)
}
