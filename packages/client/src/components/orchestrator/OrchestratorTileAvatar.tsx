import { useSettingsStore } from '../../store/settingsStore'
import { ProviderLogo } from '../../lib/providerLogo'

/** Public Orca app icon (Vite `public/`). */
const ORCA_APP_ICON = '/favicon-32.png'

/**
 * Tile header avatar: Orca app icon with a small badge for the active model’s provider.
 */
export function OrchestratorTileAvatar() {
  const currentModel = useSettingsStore((s) => {
    const list = s.getAvailableModels()
    return list.find((m) => m.id === s.selectedModel) ?? null
  })

  const label = currentModel
    ? `Orchestrator · ${currentModel.displayName}`
    : 'Orchestrator'

  return (
    <div
      className="relative h-8 w-8 shrink-0"
      role="img"
      aria-label={label}
      data-tooltip={label}
    >
      <div className="h-8 w-8 overflow-hidden rounded-full bg-black/35 ring-1 ring-white/12">
        <img
          src={ORCA_APP_ICON}
          alt=""
          width={32}
          height={32}
          draggable={false}
          className="h-full w-full object-cover"
        />
      </div>
      {currentModel && (
        <div
          className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-tile-border/95 bg-canvas-bg shadow-md"
          data-tooltip={`${currentModel.displayName}`}
        >
          <ProviderLogo provider={currentModel.provider} size={14} />
        </div>
      )}
    </div>
  )
}
