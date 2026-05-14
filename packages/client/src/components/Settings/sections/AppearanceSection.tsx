import {
  useSettingsStore,
  CANVAS_THEMES,
  type CanvasThemeId,
  type TileBorderAnimationId,
  type UiThemeId,
  type HybridGuiShellMode,
  type VisualEffectsPresetId,
  type OrchestratorDelegationLineMode,
  VISUAL_EFFECTS_DEFAULTS,
} from '../../../store/settingsStore'
import { SettingsAccordion, SettingsSurface, SettingsSwitchRow } from '../settingsPrimitives'
import { SettingsPageHeader, SettingsBlock } from '../settingsLayout'

function visualPresetLabel(p: VisualEffectsPresetId): string {
  switch (p) {
    case 'clean':
      return 'Clean & simple'
    case 'custom':
      return 'Custom'
    default:
      return 'Standard'
  }
}

export function AppearanceSection() {
  const canvasTheme = useSettingsStore((s) => s.canvasTheme)
  const setCanvasTheme = useSettingsStore((s) => s.setCanvasTheme)
  const ambientParticlesEnabled = useSettingsStore((s) => s.ambientParticlesEnabled)
  const setAmbientParticlesEnabled = useSettingsStore((s) => s.setAmbientParticlesEnabled)
  const uiTheme = useSettingsStore((s) => s.uiTheme)
  const setUiTheme = useSettingsStore((s) => s.setUiTheme)
  const hybridGuiShellMode = useSettingsStore((s) => s.hybridGuiShellMode)
  const setHybridGuiShellMode = useSettingsStore((s) => s.setHybridGuiShellMode)
  const tileBorderAnimation = useSettingsStore((s) => s.tileBorderAnimation)
  const setTileBorderAnimation = useSettingsStore((s) => s.setTileBorderAnimation)
  const visualEffectsPreset = useSettingsStore((s) => s.visualEffectsPreset)
  const setVisualEffectsPreset = useSettingsStore((s) => s.setVisualEffectsPreset)
  const orchestratorHubLinksVisible = useSettingsStore((s) => s.orchestratorHubLinksVisible)
  const setOrchestratorHubLinksVisible = useSettingsStore((s) => s.setOrchestratorHubLinksVisible)
  const orchestratorHubLinksMotionEnabled = useSettingsStore((s) => s.orchestratorHubLinksMotionEnabled)
  const setOrchestratorHubLinksMotionEnabled = useSettingsStore((s) => s.setOrchestratorHubLinksMotionEnabled)
  const hubLinksIntensityScale = useSettingsStore((s) => s.hubLinksIntensityScale)
  const setHubLinksIntensityScale = useSettingsStore((s) => s.setHubLinksIntensityScale)
  const hubLinksSpeedScale = useSettingsStore((s) => s.hubLinksSpeedScale)
  const setHubLinksSpeedScale = useSettingsStore((s) => s.setHubLinksSpeedScale)
  const tileIdleGlowEnabled = useSettingsStore((s) => s.tileIdleGlowEnabled)
  const setTileIdleGlowEnabled = useSettingsStore((s) => s.setTileIdleGlowEnabled)
  const tileIdleGlowStrength = useSettingsStore((s) => s.tileIdleGlowStrength)
  const setTileIdleGlowStrength = useSettingsStore((s) => s.setTileIdleGlowStrength)
  const shootingStarSpeedScale = useSettingsStore((s) => s.shootingStarSpeedScale)
  const setShootingStarSpeedScale = useSettingsStore((s) => s.setShootingStarSpeedScale)
  const shootingStarsHonorReducedMotion = useSettingsStore((s) => s.shootingStarsHonorReducedMotion)
  const setShootingStarsHonorReducedMotion = useSettingsStore(
    (s) => s.setShootingStarsHonorReducedMotion
  )
  const respectPrefersReducedMotion = useSettingsStore((s) => s.respectPrefersReducedMotion)
  const setRespectPrefersReducedMotion = useSettingsStore((s) => s.setRespectPrefersReducedMotion)
  const onlyAnimateFocusedTile = useSettingsStore((s) => s.onlyAnimateFocusedTile)
  const setOnlyAnimateFocusedTile = useSettingsStore((s) => s.setOnlyAnimateFocusedTile)
  const orchestratorTileRevealEffectsEnabled = useSettingsStore(
    (s) => s.orchestratorTileRevealEffectsEnabled
  )
  const setOrchestratorTileRevealEffectsEnabled = useSettingsStore(
    (s) => s.setOrchestratorTileRevealEffectsEnabled
  )
  const editorAgentLineAnimationsEnabled = useSettingsStore((s) => s.editorAgentLineAnimationsEnabled)
  const setEditorAgentLineAnimationsEnabled = useSettingsStore(
    (s) => s.setEditorAgentLineAnimationsEnabled
  )
  const obsidianBrainGraphAnimationEnabled = useSettingsStore(
    (s) => s.obsidianBrainGraphAnimationEnabled
  )
  const setObsidianBrainGraphAnimationEnabled = useSettingsStore(
    (s) => s.setObsidianBrainGraphAnimationEnabled
  )
  const tileRepulsionStrength = useSettingsStore((s) => s.tileRepulsionStrength)
  const setTileRepulsionStrength = useSettingsStore((s) => s.setTileRepulsionStrength)
  const orchestratorDelegationLineMode = useSettingsStore(
    (s) => s.orchestratorDelegationLineMode
  )
  const setOrchestratorDelegationLineMode = useSettingsStore(
    (s) => s.setOrchestratorDelegationLineMode
  )
  const resetVisualEffectsToDefaults = useSettingsStore((s) => s.resetVisualEffectsToDefaults)

  return (
    <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <SettingsPageHeader
        title="Look & motion"
        description="UI accent style, canvas colors, and animation. Changes apply immediately."
      />

      <SettingsSurface>
        <SettingsBlock
          title="App accent style"
          description="Default: brighter teal accents. Pastel: softer greens, purples, and blues."
        >
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'default' as const, label: 'Default' },
              { id: 'pastel' as const, label: 'Pastel' },
            ] satisfies { id: UiThemeId; label: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setUiTheme(opt.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                uiTheme === opt.id
                  ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                  : 'border-tile-border bg-black/20 text-gray-400 hover:border-accent-teal/40'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        </SettingsBlock>

        <SettingsBlock
          title="Hybrid shell mode"
          description="Choose between persistent right-side orchestrator chat or the spotlight quick-input launcher."
          className="mt-6 border-t border-tile-border/70 pt-5"
        >
          <div className="flex flex-wrap gap-2">
            {(
              [
                {
                  id: 'desktop_sidebar' as const,
                  label: 'Desktop sidebar',
                  detail: 'Persistent right chat panel with resizable width',
                },
                {
                  id: 'spotlight_launcher' as const,
                  label: 'Spotlight launcher',
                  detail: 'Hide right chat panel and use quick text launcher only',
                },
              ] satisfies { id: HybridGuiShellMode; label: string; detail: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setHybridGuiShellMode(opt.id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  hybridGuiShellMode === opt.id
                    ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                    : 'border-tile-border bg-black/20 text-gray-300 hover:border-accent-teal/40'
                }`}
              >
                <div>{opt.label}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">{opt.detail}</div>
              </button>
            ))}
          </div>
        </SettingsBlock>

        <SettingsBlock
          title="Canvas backdrop"
          description="Background and dot colors on the infinite canvas. Hub lines use the same palette."
          className="mt-6 border-t border-tile-border/70 pt-5"
        >
        <div className="grid grid-cols-1 gap-3">
          {(Object.keys(CANVAS_THEMES) as CanvasThemeId[]).map((id) => {
            const t = CANVAS_THEMES[id]
            const selected = canvasTheme === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setCanvasTheme(id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? 'border-accent-teal bg-accent-teal/10'
                    : 'border-tile-border bg-canvas-bg hover:border-accent-teal/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-200">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.description}</div>
                  </div>
                  {selected && (
                    <svg className="h-4 w-4 text-accent-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-4 w-10 rounded" style={{ backgroundColor: t.canvasBg }} />
                  <span className="h-4 w-10 rounded" style={{ backgroundColor: `rgb(${t.particleLineRgb})` }} />
                  <span className="h-4 w-10 rounded" style={{ backgroundColor: `rgb(${t.particleAccentRgb})` }} />
                </div>
              </button>
            )
          })}
        </div>
        </SettingsBlock>
      </SettingsSurface>

      <SettingsAccordion
        id="appearance-motion"
        title="Motion & effects"
        description="Presets, hub lines, tile glow, delegation lines, and editor highlights."
        defaultOpen
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-accent-teal/20 bg-black/15 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500">
                  Active:{' '}
                  <span className="rounded border border-tile-border bg-black/25 px-1.5 py-0.5 font-medium text-gray-400">
                    {visualPresetLabel(visualEffectsPreset)}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisualEffectsPreset('default')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    visualEffectsPreset === 'default'
                      ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                      : 'border-tile-border bg-black/20 text-gray-400 hover:border-accent-teal/40'
                  }`}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setVisualEffectsPreset('clean')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    visualEffectsPreset === 'clean'
                      ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                      : 'border-tile-border bg-black/20 text-gray-400 hover:border-accent-teal/40'
                  }`}
                >
                  Clean &amp; simple
                </button>
                <button
                  type="button"
                  onClick={() => resetVisualEffectsToDefaults()}
                  className="rounded-lg border border-tile-border bg-black/25 px-3 py-1.5 text-xs font-medium text-gray-400 hover:border-accent-teal/35 hover:text-gray-200"
                >
                  Reset motion
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-tile-border/80 bg-black/15 p-3">
            <h4 className="text-xs font-medium text-gray-400">Orchestrator hub lines</h4>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-gray-200">Show hub connection lines</span>
              <input
                type="checkbox"
                checked={orchestratorHubLinksVisible}
                onChange={(e) => setOrchestratorHubLinksVisible(e.target.checked)}
                className="h-4 w-4 accent-accent-teal"
              />
            </label>
            <label
              className={`flex cursor-pointer items-center justify-between gap-3 ${
                !orchestratorHubLinksVisible ? 'opacity-40' : ''
              }`}
            >
              <span className="text-sm text-gray-200">Animate dashes &amp; sparks</span>
              <input
                type="checkbox"
                disabled={!orchestratorHubLinksVisible}
                checked={orchestratorHubLinksMotionEnabled}
                onChange={(e) => setOrchestratorHubLinksMotionEnabled(e.target.checked)}
                className="h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-200">Line brightness</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={hubLinksIntensityScale}
                onChange={(e) => setHubLinksIntensityScale(parseFloat(e.target.value))}
                disabled={!orchestratorHubLinksVisible}
                className="orca-range w-full accent-accent-teal disabled:opacity-40"
              />
              <span className="text-xs text-gray-500">
                Default {VISUAL_EFFECTS_DEFAULTS.hubLinksIntensityScale}; now {hubLinksIntensityScale.toFixed(2)}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-200">Dash animation speed</span>
              <input
                type="range"
                min={0.45}
                max={2}
                step={0.05}
                value={hubLinksSpeedScale}
                onChange={(e) => setHubLinksSpeedScale(parseFloat(e.target.value))}
                disabled={!orchestratorHubLinksVisible}
                className="orca-range w-full accent-accent-teal disabled:opacity-40"
              />
              <span className="text-xs text-gray-500">Multiplier: {hubLinksSpeedScale.toFixed(2)}×</span>
            </label>
          </div>

          <div className="space-y-3 rounded-lg border border-tile-border/80 bg-black/15 p-3">
            <h4 className="text-xs font-medium text-gray-400">Tiles</h4>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-gray-200">Idle tile glow</span>
              <input
                type="checkbox"
                checked={tileIdleGlowEnabled}
                onChange={(e) => setTileIdleGlowEnabled(e.target.checked)}
                className="h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-200">Glow strength</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={tileIdleGlowStrength}
                onChange={(e) => setTileIdleGlowStrength(parseFloat(e.target.value))}
                disabled={!tileIdleGlowEnabled}
                className="orca-range w-full accent-accent-teal disabled:opacity-40"
              />
            </label>
            <label className="flex flex-col gap-1 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Tile repulsion strength</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={tileRepulsionStrength}
                onChange={(e) => setTileRepulsionStrength(parseFloat(e.target.value))}
                className="orca-range w-full accent-accent-teal"
              />
              <span className="text-xs text-gray-500">
                0 = no push-apart, 1 = default. Now {tileRepulsionStrength.toFixed(2)}×
              </span>
            </label>
            <label className="flex flex-col gap-1 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Lead → worker lines</span>
              <select
                value={orchestratorDelegationLineMode}
                onChange={(e) =>
                  setOrchestratorDelegationLineMode(
                    e.target.value as OrchestratorDelegationLineMode
                  )
                }
                className="rounded border border-tile-border bg-black/25 px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent-teal"
              >
                <option value="branch">Branch (lead → workers)</option>
                <option value="radial">Radial (hub → all)</option>
                <option value="both">Both (branch + faded hub)</option>
              </select>
              <span className="text-xs text-gray-500">How lines are drawn from orchestrator to workers.</span>
            </label>
          </div>

          <div className="space-y-3 rounded-lg border border-tile-border/80 bg-black/15 p-3">
            <h4 className="text-xs font-medium text-gray-400">Focus & editor</h4>
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span className="text-sm text-gray-200">Highlight orchestrator tile when focused</span>
              <input
                type="checkbox"
                checked={orchestratorTileRevealEffectsEnabled}
                onChange={(e) => setOrchestratorTileRevealEffectsEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Animate agent highlights in the editor</span>
              <input
                type="checkbox"
                checked={editorAgentLineAnimationsEnabled}
                onChange={(e) => setEditorAgentLineAnimationsEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Animate edges in Obsidian brain graph</span>
              <input
                type="checkbox"
                checked={obsidianBrainGraphAnimationEnabled}
                onChange={(e) => setObsidianBrainGraphAnimationEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Honor system “reduce motion”</span>
              <input
                type="checkbox"
                checked={respectPrefersReducedMotion}
                onChange={(e) => setRespectPrefersReducedMotion(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent-teal"
              />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-tile-border/60 pt-3">
              <span className="text-sm text-gray-200">Only animate focused tile (default)</span>
              <input
                type="checkbox"
                checked={onlyAnimateFocusedTile}
                onChange={(e) => setOnlyAnimateFocusedTile(e.target.checked)}
                className="mt-1 h-4 w-4 accent-accent-teal"
              />
            </label>
          </div>
        </div>
      </SettingsAccordion>

      <SettingsAccordion
        id="appearance-borders"
        title="Idle tile border"
        description="Optional moving highlight on tile edges when idle."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'off' as const, label: 'Off' },
                { id: 'single' as const, label: 'Single star' },
                { id: 'double' as const, label: 'Double star' },
              ] satisfies { id: TileBorderAnimationId; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTileBorderAnimation(opt.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  tileBorderAnimation === opt.id
                    ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                    : 'border-tile-border bg-black/20 text-gray-400 hover:border-accent-teal/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-200">Orbit speed</span>
            <input
              type="range"
              min={0.45}
              max={2}
              step={0.05}
              value={shootingStarSpeedScale}
              onChange={(e) => setShootingStarSpeedScale(parseFloat(e.target.value))}
              disabled={tileBorderAnimation === 'off'}
              className="orca-range w-full accent-accent-teal disabled:opacity-40"
            />
            <span className="text-xs text-gray-500">
              Default {VISUAL_EFFECTS_DEFAULTS.shootingStarSpeedScale}; now {shootingStarSpeedScale.toFixed(2)}×
            </span>
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-tile-border/60 bg-black/10 px-3 py-2">
            <span className="text-sm text-gray-200">Pause border animation when system requests reduced motion</span>
            <input
              type="checkbox"
              checked={shootingStarsHonorReducedMotion}
              onChange={(e) => setShootingStarsHonorReducedMotion(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-accent-teal"
            />
          </label>
        </div>
      </SettingsAccordion>

      <SettingsSurface>
        <SettingsSwitchRow
          title="Ambient lines on canvas"
          description="Subtle moving lines behind tiles. Off by default."
          checked={ambientParticlesEnabled}
          onChange={setAmbientParticlesEnabled}
        />
      </SettingsSurface>
    </div>
  )
}
