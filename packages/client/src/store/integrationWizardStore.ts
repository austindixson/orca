import { create } from 'zustand'
import type { IntegrationId } from '../lib/integrations/integrationCatalog'

interface IntegrationWizardState {
  open: boolean
  /** When opening the wizard, pre-select this integration (consumed on open). */
  integrationIdToSelectOnOpen: IntegrationId | null
  setOpen: (open: boolean) => void
}

export const useIntegrationWizardStore = create<IntegrationWizardState>((set) => ({
  open: false,
  integrationIdToSelectOnOpen: null,
  setOpen: (open) =>
    set({
      open,
      ...(open ? {} : { integrationIdToSelectOnOpen: null }),
    }),
}))
