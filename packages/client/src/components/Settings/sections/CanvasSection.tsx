import type { TileType } from '../../../store/canvasStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { CANVAS_TILE_OPTIONS, filterCanvasTileOptionsForHermesSetting } from '../../../lib/tileMenuCatalog'
import { SettingsSurface, SettingsSwitchRow } from '../settingsPrimitives'
import { SettingsPageHeader } from '../settingsLayout'
import { CLASS_MIN_GAP_MS } from '../../../lib/tileLoadProfile'

export function CanvasSection() {
  const changelogAutomationEnabled = useSettingsStore((s) => s.changelogAutomationEnabled)
  const setChangelogAutomationEnabled = useSettingsStore((s) => s.setChangelogAutomationEnabled)
  const researchAutomationEnabled = useSettingsStore((s) => s.researchAutomationEnabled)
  const setResearchAutomationEnabled = useSettingsStore((s) => s.setResearchAutomationEnabled)
  const tilePicker = useSettingsStore((s) => s.tilePicker)
  const setTileVisibility = useSettingsStore((s) => s.setTileVisibility)
  const setTileFavorite = useSettingsStore((s) => s.setTileFavorite)
  const remotionOutputDir = useSettingsStore((s) => s.remotionOutputDir)
  const setRemotionOutputDir = useSettingsStore((s) => s.setRemotionOutputDir)
  const picassoMode = useSettingsStore((s) => s.picassoMode)
  const setPicassoMode = useSettingsStore((s) => s.setPicassoMode)
  const intelligentLayoutEnabled = useSettingsStore((s) => s.intelligentLayoutEnabled)
  const setIntelligentLayoutEnabled = useSettingsStore((s) => s.setIntelligentLayoutEnabled)
  const intelligentLayoutAnchorRatio = useSettingsStore((s) => s.intelligentLayoutAnchorRatio)
  const setIntelligentLayoutAnchorRatio = useSettingsStore((s) => s.setIntelligentLayoutAnchorRatio)
  const intelligentLayoutAutoDetectAnchor = useSettingsStore((s) => s.intelligentLayoutAutoDetectAnchor)
  const setIntelligentLayoutAutoDetectAnchor = useSettingsStore(
    (s) => s.setIntelligentLayoutAutoDetectAnchor
  )
  const graphLinksDelegationEnabled = useSettingsStore((s) => s.graphLinksDelegationEnabled)
  const setGraphLinksDelegationEnabled = useSettingsStore((s) => s.setGraphLinksDelegationEnabled)
  const graphLinksDataFlowEnabled = useSettingsStore((s) => s.graphLinksDataFlowEnabled)
  const setGraphLinksDataFlowEnabled = useSettingsStore((s) => s.setGraphLinksDataFlowEnabled)
  const graphLinksManualEnabled = useSettingsStore((s) => s.graphLinksManualEnabled)
  const setGraphLinksManualEnabled = useSettingsStore((s) => s.setGraphLinksManualEnabled)
  const graphPhysicsStrength = useSettingsStore((s) => s.graphPhysicsStrength)
  const setGraphPhysicsStrength = useSettingsStore((s) => s.setGraphPhysicsStrength)
  const graphNodeScale = useSettingsStore((s) => s.graphNodeScale)
  const setGraphNodeScale = useSettingsStore((s) => s.setGraphNodeScale)
  const graphSyncOnExit = useSettingsStore((s) => s.graphSyncOnExit)
  const setGraphSyncOnExit = useSettingsStore((s) => s.setGraphSyncOnExit)
  const tileLiveMagneticDragEnabled = useSettingsStore((s) => s.tileLiveMagneticDragEnabled)
  const setTileLiveMagneticDragEnabled = useSettingsStore((s) => s.setTileLiveMagneticDragEnabled)
  const orchestratorGroupFollowEnabled = useSettingsStore((s) => s.orchestratorGroupFollowEnabled)
  const setOrchestratorGroupFollowEnabled = useSettingsStore((s) => s.setOrchestratorGroupFollowEnabled)
  const orchestratorGroupFollowStrength = useSettingsStore((s) => s.orchestratorGroupFollowStrength)
  const setOrchestratorGroupFollowStrength = useSettingsStore((s) => s.setOrchestratorGroupFollowStrength)
  const graphLiveMagneticDragEnabled = useSettingsStore((s) => s.graphLiveMagneticDragEnabled)
  const setGraphLiveMagneticDragEnabled = useSettingsStore((s) => s.setGraphLiveMagneticDragEnabled)
  const graphAdvancedWorkflowEnabled = useSettingsStore((s) => s.graphAdvancedWorkflowEnabled)
  const setGraphAdvancedWorkflowEnabled = useSettingsStore((s) => s.setGraphAdvancedWorkflowEnabled)
  const graphContextRadius = useSettingsStore((s) => s.graphContextRadius)
  const setGraphContextRadius = useSettingsStore((s) => s.setGraphContextRadius)
  const oneShotArchitectureDiagramMode = useSettingsStore((s) => s.oneShotArchitectureDiagramMode)
  const setOneShotArchitectureDiagramMode = useSettingsStore((s) => s.setOneShotArchitectureDiagramMode)
  const agentWriteStreamEnabled = useSettingsStore((s) => s.agentWriteStreamEnabled)
  const setAgentWriteStreamEnabled = useSettingsStore((s) => s.setAgentWriteStreamEnabled)
  const showHermesAgentTile = useSettingsStore((s) => s.showHermesAgentTile)

  const tileMenuRows = filterCanvasTileOptionsForHermesSetting(CANVAS_TILE_OPTIONS, showHermesAgentTile)

  return (
    <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <SettingsPageHeader
        title="Workspace"
        description="Tiles, editor behavior, layout, and video output paths."
      />

      <SettingsSurface>
        <SettingsSwitchRow
          title="Stream file writes in the editor"
          description="Show new lines gradually (~1000 characters per second, capped) instead of pasting the whole file at once. Large writes may skip streaming."
          checked={agentWriteStreamEnabled}
          onChange={setAgentWriteStreamEnabled}
        />
        <p className="mt-2 text-xs text-gray-500">On by default.</p>
      </SettingsSurface>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">One-shot architecture diagram</h3>
        <p className="mt-1 text-xs text-gray-500">
          In one-shot planning, phase 3 writes{' '}
          <code className="rounded bg-black/35 px-1">ARCHITECTURE.html</code>. Default style matches{' '}
          <a
            href="https://github.com/Cocoon-AI/architecture-diagram-generator"
            target="_blank"
            rel="noreferrer"
            className="text-accent-teal/90 underline decoration-dotted underline-offset-2 hover:text-accent-teal"
          >
            Cocoon AI
          </a>
          . The other option uses Mermaid-style cards instead.
        </p>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="1-shot architecture diagram style">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-tile-border bg-black/15 px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-teal/40">
            <input
              type="radio"
              name="one-shot-arch-diagram"
              className="mt-0.5 accent-accent-teal"
              checked={oneShotArchitectureDiagramMode === 'cocoon_ai'}
              onChange={() => setOneShotArchitectureDiagramMode('cocoon_ai')}
            />
            <span>
              <span className="text-sm text-gray-200">Cocoon AI (default)</span>
              <span className="mt-0.5 block text-xs text-gray-500">HTML with inline SVG and a dark canvas.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-tile-border bg-black/15 px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-teal/40">
            <input
              type="radio"
              name="one-shot-arch-diagram"
              className="mt-0.5 accent-accent-teal"
              checked={oneShotArchitectureDiagramMode === 'visual_explainer'}
              onChange={() => setOneShotArchitectureDiagramMode('visual_explainer')}
            />
            <span>
              <span className="text-sm text-gray-200">Visual explainer</span>
              <span className="mt-0.5 block text-xs text-gray-500">Mermaid diagrams and module cards.</span>
            </span>
          </label>
        </div>
      </SettingsSurface>

      <SettingsSurface>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-200">New tile menu</h3>
          <span className="text-xs text-gray-500">
            Visible{' '}
            {
              tileMenuRows.filter((opt) => tilePicker[opt.type]?.visible !== false).length
            }
            /{tileMenuRows.length}
          </span>
        </div>
        <div className="space-y-2">
          {tileMenuRows.map((opt) => {
            const pref = tilePicker[opt.type]
            const visible = pref?.visible !== false
            const favorite = pref?.favorite === true
            return (
              <div
                key={opt.type}
                className="flex items-center justify-between rounded-lg border border-tile-border/80 bg-black/15 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`w-5 shrink-0 text-center font-mono text-xs ${opt.colorClass}`}>
                    {opt.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-200">{opt.label}</div>
                    <div className="text-xs text-gray-500">{opt.type}</div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTileFavorite(opt.type as TileType, !favorite)}
                    className={`rounded border px-2 py-1 text-[11px] ${
                      favorite
                        ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                        : 'border-tile-border bg-black/30 text-gray-500 hover:text-gray-300'
                    }`}
                    data-tooltip={favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    ★
                  </button>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => setTileVisibility(opt.type as TileType, e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="relative h-6 w-11 rounded-full bg-gray-700 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-accent-teal peer-checked:after:translate-x-full" />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </SettingsSurface>

      <details className="rounded-xl border border-tile-border bg-canvas-bg open:border-accent-teal/25" open>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-200 outline-none ring-accent-teal/40 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between">
            Auto-open tiles
            <span className="text-gray-500">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </span>
          <p className="mt-1 text-xs font-normal text-gray-500">
            Open a changelog or research tile when your workflow suggests it.
          </p>
        </summary>
        <div className="space-y-4 border-t border-tile-border/80 px-4 pb-4 pt-3">
          <SettingsSurface className="!bg-black/10">
            <SettingsSwitchRow
              title="Changelog tile"
              description="After edits, open a changelog tile if git has uncommitted changes (not on app start)."
              checked={changelogAutomationEnabled}
              onChange={setChangelogAutomationEnabled}
            />
            <p className="mt-2 text-xs text-gray-500">On by default.</p>
          </SettingsSurface>
          <SettingsSurface className="!bg-black/10">
            <SettingsSwitchRow
              title="Research tile"
              description="When you first search the web or docs, open a Research tile if you do not have one."
              checked={researchAutomationEnabled}
              onChange={setResearchAutomationEnabled}
            />
            <p className="mt-2 text-xs text-gray-500">On by default.</p>
          </SettingsSurface>
        </div>
      </details>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">Multiple tiles per module</h3>
        <p className="mt-1 text-xs text-gray-500">
          Off: one tile per module type (tabs inside). On: many separate tiles; uses more resources.
        </p>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
          <span className="text-sm text-gray-200">Allow unlimited duplicate tiles</span>
          <input
            type="checkbox"
            checked={picassoMode}
            onChange={(e) => setPicassoMode(e.target.checked)}
            className="h-4 w-4 accent-accent-teal"
          />
        </label>
      </SettingsSurface>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">Smart layout</h3>
        <p className="mt-1 text-xs text-gray-500">
          Keep key tiles near the center and nudge related tiles based on workspace hints.
        </p>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
          <span className="text-sm text-gray-200">Enable smart layout</span>
          <input
            type="checkbox"
            checked={intelligentLayoutEnabled}
            onChange={(e) => setIntelligentLayoutEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent-teal"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
          <span className="text-sm text-gray-200">Center anchor size</span>
          <input
            type="range"
            min={0.45}
            max={0.85}
            step={0.05}
            value={intelligentLayoutAnchorRatio}
            onChange={(e) => setIntelligentLayoutAnchorRatio(parseFloat(e.target.value))}
            className="orca-range w-full accent-accent-teal"
          />
          <span className="text-xs text-gray-500">Share of the view used for the anchor: {Math.round(intelligentLayoutAnchorRatio * 100)}%</span>
        </label>
        <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
          <span className="text-sm text-gray-200">Pick anchor automatically on first open</span>
          <input
            type="checkbox"
            checked={intelligentLayoutAutoDetectAnchor}
            onChange={(e) => setIntelligentLayoutAutoDetectAnchor(e.target.checked)}
            className="h-4 w-4 accent-accent-teal"
          />
        </label>
      </SettingsSurface>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">Graph mode (Obsidian-style)</h3>
        <p className="mt-1 text-xs text-gray-500">
          Controls for the force-directed graph view toggle in the canvas toolbar.
        </p>
        <div className="mt-3 space-y-2 rounded-lg border border-tile-border bg-black/15 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Show delegation links</span>
            <input
              type="checkbox"
              checked={graphLinksDelegationEnabled}
              onChange={(e) => setGraphLinksDelegationEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Show data-flow links</span>
            <input
              type="checkbox"
              checked={graphLinksDataFlowEnabled}
              onChange={(e) => setGraphLinksDataFlowEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Show manual links</span>
            <input
              type="checkbox"
              checked={graphLinksManualEnabled}
              onChange={(e) => setGraphLinksManualEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-200">Physics strength</span>
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.1}
              value={graphPhysicsStrength}
              onChange={(e) => setGraphPhysicsStrength(parseFloat(e.target.value))}
              className="orca-range mt-2 w-full accent-accent-teal"
            />
            <span className="mt-1 block text-xs text-gray-500">{graphPhysicsStrength.toFixed(1)}x</span>
          </label>
          <label className="block">
            <span className="text-sm text-gray-200">Node size</span>
            <input
              type="range"
              min={0.6}
              max={1.8}
              step={0.1}
              value={graphNodeScale}
              onChange={(e) => setGraphNodeScale(parseFloat(e.target.value))}
              className="orca-range mt-2 w-full accent-accent-teal"
            />
            <span className="mt-1 block text-xs text-gray-500">{graphNodeScale.toFixed(1)}x</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Sync graph layout when returning to tiles</span>
            <input
              type="checkbox"
              checked={graphSyncOnExit}
              onChange={(e) => setGraphSyncOnExit(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Live magnetic drag (Tiles)</span>
            <input
              type="checkbox"
              checked={tileLiveMagneticDragEnabled}
              onChange={(e) => setTileLiveMagneticDragEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Orchestrator group-follow drag</span>
            <input
              type="checkbox"
              checked={orchestratorGroupFollowEnabled}
              onChange={(e) => setOrchestratorGroupFollowEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-200">Orchestrator follower strength</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={orchestratorGroupFollowStrength}
              onChange={(e) => setOrchestratorGroupFollowStrength(parseFloat(e.target.value))}
              className="orca-range mt-2 w-full accent-accent-teal"
            />
            <span className="mt-1 block text-xs text-gray-500">{orchestratorGroupFollowStrength.toFixed(2)}x</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Live magnetic drag (Graph)</span>
            <input
              type="checkbox"
              checked={graphLiveMagneticDragEnabled}
              onChange={(e) => setGraphLiveMagneticDragEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm text-gray-200">Enable advanced graph workflow</span>
            <input
              type="checkbox"
              checked={graphAdvancedWorkflowEnabled}
              onChange={(e) => setGraphAdvancedWorkflowEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent-teal"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-200">Nearby context radius</span>
            <input
              type="range"
              min={120}
              max={1600}
              step={20}
              value={graphContextRadius}
              onChange={(e) => setGraphContextRadius(parseInt(e.target.value, 10))}
              className="orca-range mt-2 w-full accent-accent-teal"
            />
            <span className="mt-1 block text-xs text-gray-500">{graphContextRadius}px</span>
          </label>
        </div>
      </SettingsSurface>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">Video export folder</h3>
        <p className="mt-1 text-xs text-gray-500">Where Remotion writes files, relative to the workspace.</p>
        <input
          type="text"
          value={remotionOutputDir}
          onChange={(e) => setRemotionOutputDir(e.target.value)}
          placeholder="videos/remotion"
          className="mt-3 w-full rounded-lg border border-tile-border bg-tile-bg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-accent-teal focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          Example: <code className="rounded bg-black/35 px-1">./{remotionOutputDir || 'videos/remotion'}/demo.mp4</code>
        </p>
      </SettingsSurface>

      <SettingsSurface>
        <h3 className="text-sm font-medium text-gray-200">Reopening a project</h3>
        <p className="mt-1 text-xs text-gray-500">
          Tiles load in batches so heavy ones (terminals, browsers, agents) do not all start at once.
        </p>
        <div className="mt-3 space-y-2 rounded-lg border border-tile-border bg-black/15 px-3 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Light tiles</span>
            <span className="text-gray-200">{CLASS_MIN_GAP_MS.light}ms gap</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Medium tiles</span>
            <span className="text-gray-200">{CLASS_MIN_GAP_MS.medium}ms gap</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Heavy tiles</span>
            <span className="text-gray-200">{CLASS_MIN_GAP_MS.heavy}ms gap</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          A banner offers Pause, Safe Mode (skip heavy tiles), and Activate all. After a crash, the next open
          starts in Safe Mode.
        </p>
      </SettingsSurface>
    </div>
  )
}
