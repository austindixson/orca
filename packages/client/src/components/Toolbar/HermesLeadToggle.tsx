import { useSettingsStore } from '../../store/settingsStore'

/**
 * Toolbar toggle that flips the in-app orchestrator between the default lead
 * (provider/model chosen in `OrchestratorModelPicker`) and **Hermes** (forces
 * `selectedModel === HERMES_PROVIDER_MODEL_ID`). The previous model id is
 * remembered in `settingsStore.leadProfilePreviousModelId`, so untoggling
 * restores whatever was selected before the flip.
 *
 * Distinct from `settingsStore.hermesOrchestratorMode`, which hands off
 * *planning* to an external Hermes bridge — this toggle keeps Orca as the
 * runtime but sends the orchestrator loop through the local Hermes gateway.
 */
export function HermesLeadToggle() {
  const leadProfile = useSettingsStore((s) => s.leadProfile)
  const setLeadProfile = useSettingsStore((s) => s.setLeadProfile)
  const active = leadProfile === 'hermes'

  return (
    <button
      type="button"
      onClick={() => setLeadProfile(active ? 'default' : 'hermes')}
      aria-pressed={active}
      data-tooltip={
        active
          ? 'Hermes is currently the lead orchestrator — click to restore your previous model.'
          : 'Switch the orchestrator to Hermes (local Hermes gateway becomes the lead model).'
      }
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-accent-teal/60 bg-accent-teal/15 text-accent-teal shadow-[0_0_0_1px_rgba(45,212,191,0.25)_inset]'
          : 'border-tile-border text-gray-400 hover:text-accent-teal hover:border-accent-teal/40'
      }`}
    >
      <HermesMark active={active} />
      <span>Hermes lead</span>
      {active && (
        <span className="h-1.5 w-1.5 rounded-full bg-accent-teal shadow-[0_0_6px_rgba(var(--accent-teal-rgb),0.7)]" />
      )}
    </button>
  )
}

/**
 * Inline Hermes mark — a stylised caduceus-adjacent glyph (winged H) kept as
 * pure SVG so we don't need to ship a separate asset. Uses `currentColor` so
 * it inherits the button's active/idle teal palette.
 */
function HermesMark({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 4v16" />
      <path d="M18 4v16" />
      <path d="M6 12h12" />
      <path d="M3 7c2 1.5 4 1.5 6 0" />
      <path d="M15 7c2 1.5 4 1.5 6 0" />
    </svg>
  )
}
