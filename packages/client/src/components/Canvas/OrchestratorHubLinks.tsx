import { useMemo } from 'react'
import type { CanvasThemeConfig } from '../../store/settingsStore'
import {
  CANVAS_THEMES,
  getEffectiveHubLinkTheme,
  hubLinksMotionEffective,
  useSettingsStore,
  type HubLinkThemeConfig,
  type OrchestratorDelegationLineMode,
} from '../../store/settingsStore'
import type { TileData } from '../../store/canvasStore'
import { useCanvasStore } from '../../store/canvasStore'
import {
  sessionKeyForOrchestratorTileId,
  useOrchestratorActivityStore,
} from '../../store/orchestratorActivityStore'
import { useAgentTeamStore } from '../../store/agentTeamStore'

const PAD = 96

/** Distinct hues for per-agent hub link animations (stable assignment via tile id hash). */
const AGENT_LINK_HUES = [185, 268, 42, 312, 28, 152, 205, 330]

function agentLinkHue(tileId: string): number {
  let h = 0
  for (let i = 0; i < tileId.length; i++) {
    h = (h + tileId.charCodeAt(i) * (i + 1)) % 1009
  }
  return AGENT_LINK_HUES[h % AGENT_LINK_HUES.length]
}

function hubLinkStylesForSource(
  sourceSessionTileId: string | null | undefined,
  tiles: Map<string, TileData>,
  canvas: CanvasThemeConfig,
  hubTheme: HubLinkThemeConfig
): {
  track: string
  flow: string
  spark: string
  filterFlow: string
  filterSpark: string
} {
  const hub = hubTheme
  const lineRgb = canvas.particleLineRgb
  const accentRgb = canvas.particleAccentRgb
  const v = hub.vibrance
  const sat = hub.saturation

  const sHue = (n: number) => Math.min(100, Math.round(n * sat))

  const themeAccentStroke = () => ({
    track: `rgba(${lineRgb}, ${hub.trackOpacity})`,
    flow: `rgba(${accentRgb}, ${0.72 + 0.16 * v})`,
    spark: `rgba(255, 255, 255, ${0.38 + 0.22 * v})`,
    filterFlow: `drop-shadow(0 0 ${3 + 5 * v}px rgba(${accentRgb}, ${0.26 + 0.32 * v}))`,
    filterSpark: `drop-shadow(0 0 ${4 + 6 * v}px rgba(${accentRgb}, ${0.3 + 0.38 * v}))`,
  })

  if (!sourceSessionTileId) {
    return themeAccentStroke()
  }
  const src = tiles.get(sourceSessionTileId)
  if (!src || src.type === 'orchestrator') {
    return themeAccentStroke()
  }
  if (src.type === 'agent') {
    const hue = agentLinkHue(sourceSessionTileId)
    return {
      track: `hsl(${hue} ${sHue(42)}% 52% / ${hub.trackOpacity})`,
      flow: `hsl(${hue} ${sHue(74)}% ${58 - (1 - sat) * 4}%)`,
      spark: `hsl(${hue} ${sHue(90)}% ${82 - (1 - sat) * 6}%)`,
      filterFlow: `drop-shadow(0 0 ${3 + 5 * v}px hsl(${hue} ${sHue(70)}% 45% / ${0.28 + 0.36 * v}))`,
      filterSpark: `drop-shadow(0 0 ${4 + 6 * v}px hsl(${hue} ${sHue(85)}% 55% / ${0.34 + 0.36 * v}))`,
    }
  }
  return themeAccentStroke()
}

function isCanvasSuppressedTile(tile: TileData): boolean {
  const meta = tile.meta as Record<string, unknown> | undefined
  return meta?.suppressCanvasRender === true
}

function pickOrchestratorHub(tiles: TileData[]): TileData | null {
  const orch = tiles.filter((t) => t.type === 'orchestrator')
  if (orch.length === 0) return null
  return orch.reduce((a, b) => (a.zIndex >= b.zIndex ? a : b))
}

function computeBounds(tiles: TileData[]): { minX: number; minY: number; width: number; height: number } | null {
  if (tiles.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of tiles) {
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + t.w)
    maxY = Math.max(maxY, t.y + t.h)
  }
  return {
    minX: minX - PAD,
    minY: minY - PAD,
    width: maxX - minX + 2 * PAD,
    height: maxY - minY + 2 * PAD,
  }
}

function tileCenterInSvg(t: TileData, bounds: { minX: number; minY: number }): { x: number; y: number } {
  return {
    x: t.x + t.w / 2 - bounds.minX,
    y: t.y + t.h / 2 - bounds.minY,
  }
}

type HubLinkStyles = ReturnType<typeof hubLinkStylesForSource>

/** Teal (read) / amber (write) overrides for hub→module “attention” lines. */
function hubLinkAccentStyles(
  accent: 'read' | 'write' | null
): HubLinkStyles | null {
  if (accent === 'read') {
    return {
      track: 'rgba(45, 212, 191, 0.2)',
      flow: 'rgba(45, 212, 191, 0.92)',
      spark: 'rgba(200, 255, 250, 0.78)',
      filterFlow: 'drop-shadow(0 0 6px rgba(45, 212, 191, 0.52))',
      filterSpark: 'drop-shadow(0 0 7px rgba(45, 212, 191, 0.45))',
    }
  }
  if (accent === 'write') {
    return {
      track: 'rgba(251, 191, 36, 0.22)',
      flow: 'rgba(245, 158, 11, 0.95)',
      spark: 'rgba(255, 235, 200, 0.8)',
      filterFlow: 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.5))',
      filterSpark: 'drop-shadow(0 0 7px rgba(251, 191, 36, 0.42))',
    }
  }
  return null
}

function HubLinkSegment(props: {
  x1: number
  y1: number
  x2: number
  y2: number
  styles: HubLinkStyles
  staggerIndex: number
  flowDur: number
  sparkDur: number
  flowOpacity: number
  sparkOpacity: number
  rev: boolean
  /** Faster dash animation while a tool is active on this link */
  flowSpeedBoost?: number
  motionEnabled?: boolean
}) {
  const {
    x1,
    y1,
    x2,
    y2,
    styles,
    staggerIndex,
    flowDur,
    sparkDur,
    flowOpacity,
    sparkOpacity,
    rev,
    flowSpeedBoost = 1,
    motionEnabled = true,
  } = props
  const len = Math.hypot(x2 - x1, y2 - y1)
  const dash = Math.max(5, Math.min(18, len * 0.042))
  const gap = Math.max(8, Math.min(30, len * 0.095))
  const flowPeriod = -(dash + gap)
  const sparkD = Math.max(3, dash * 0.35)
  const sparkG = gap + dash * 2
  const sparkPeriod = -(sparkD + sparkG)

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="orchestrator-hub-link-track"
        style={{ stroke: styles.track }}
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="orchestrator-hub-link-flow"
        strokeDasharray={`${dash} ${gap}`}
        style={{
          ['--hub-flow-period' as string]: String(flowPeriod),
          stroke: styles.flow,
          filter: styles.filterFlow,
          ...(motionEnabled
            ? {
                animationDuration: `${flowDur / flowSpeedBoost}s`,
                animationDirection: rev ? 'reverse' : 'normal',
                animationDelay: `${staggerIndex * 0.14}s`,
              }
            : { animation: 'none' }),
          opacity: flowOpacity,
        }}
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="orchestrator-hub-link-spark"
        strokeDasharray={`${sparkD} ${sparkG}`}
        style={{
          ['--hub-spark-period' as string]: String(sparkPeriod),
          stroke: styles.spark,
          filter: styles.filterSpark,
          ...(motionEnabled
            ? {
                animationDuration: `${sparkDur / flowSpeedBoost}s`,
                animationDirection: rev ? 'normal' : 'reverse',
                animationDelay: `${staggerIndex * 0.09 + 0.2}s`,
              }
            : { animation: 'none' }),
          opacity: sparkOpacity,
        }}
      />
    </g>
  )
}

/** Quadratic curve from parent agent to delegated child — reads clearer than a straight chord. */
function delegationBranchPathD(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { d: string; len: number } {
  const mx = (x1 + x2) / 2
  const lift = Math.min(72, Math.max(32, Math.abs(y2 - y1) * 0.38 + 22))
  const cy = Math.min(y1, y2) - lift
  const d = `M ${x1} ${y1} Q ${mx} ${cy} ${x2} ${y2}`
  const len =
    Math.hypot(mx - x1, cy - y1) +
    Math.hypot(x2 - mx, y2 - cy)
  return { d, len }
}

function HubLinkCurveSegment(props: {
  d: string
  len: number
  styles: HubLinkStyles
  staggerIndex: number
  flowDur: number
  sparkDur: number
  flowOpacity: number
  sparkOpacity: number
  rev: boolean
  flowSpeedBoost?: number
  motionEnabled?: boolean
}) {
  const {
    d,
    len,
    styles,
    staggerIndex,
    flowDur,
    sparkDur,
    flowOpacity,
    sparkOpacity,
    rev,
    flowSpeedBoost = 1,
    motionEnabled = true,
  } = props
  const dash = Math.max(5, Math.min(18, len * 0.042))
  const gap = Math.max(8, Math.min(30, len * 0.095))
  const flowPeriod = -(dash + gap)
  const sparkD = Math.max(3, dash * 0.35)
  const sparkG = gap + dash * 2
  const sparkPeriod = -(sparkD + sparkG)

  return (
    <g>
      <path
        d={d}
        className="orchestrator-hub-link-track"
        style={{ stroke: styles.track }}
      />
      <path
        d={d}
        className="orchestrator-hub-link-flow"
        strokeDasharray={`${dash} ${gap}`}
        style={{
          ['--hub-flow-period' as string]: String(flowPeriod),
          stroke: styles.flow,
          filter: styles.filterFlow,
          ...(motionEnabled
            ? {
                animationDuration: `${flowDur / flowSpeedBoost}s`,
                animationDirection: rev ? 'reverse' : 'normal',
                animationDelay: `${staggerIndex * 0.14}s`,
              }
            : { animation: 'none' }),
          opacity: flowOpacity,
        }}
      />
      <path
        d={d}
        className="orchestrator-hub-link-spark"
        strokeDasharray={`${sparkD} ${sparkG}`}
        style={{
          ['--hub-spark-period' as string]: String(sparkPeriod),
          stroke: styles.spark,
          filter: styles.filterSpark,
          ...(motionEnabled
            ? {
                animationDuration: `${sparkDur / flowSpeedBoost}s`,
                animationDirection: rev ? 'normal' : 'reverse',
                animationDelay: `${staggerIndex * 0.09 + 0.2}s`,
              }
            : { animation: 'none' }),
          opacity: sparkOpacity,
        }}
      />
    </g>
  )
}

/**
 * World-space SVG behind tiles: glowing animated “data” lines from the orchestrator hub
 * to other modules. When a sub-agent session targets a module, the path is **hub → agent → module**
 * (two segments; the duplicate hub→agent link on the agent tile row is omitted).
 * Otherwise: hub → tile. Opacity intensifies while a tool targets a module.
 */
export function OrchestratorHubLinks() {
  const tilesMap = useCanvasStore((s) => s.tiles)
  const canvasThemeId = useSettingsStore((s) => s.canvasTheme)
  const orchestratorHubLinksVisible = useSettingsStore((s) => s.orchestratorHubLinksVisible)
  const hubLinksIntensityScale = useSettingsStore((s) => s.hubLinksIntensityScale)
  const hubLinksSpeedScale = useSettingsStore((s) => s.hubLinksSpeedScale)
  const orchestratorHubLinksMotionEnabled = useSettingsStore((s) => s.orchestratorHubLinksMotionEnabled)
  const respectPrefersReducedMotion = useSettingsStore((s) => s.respectPrefersReducedMotion)
  const delegationLineMode: OrchestratorDelegationLineMode = useSettingsStore(
    (s) => s.orchestratorDelegationLineMode
  )
  const canvas = CANVAS_THEMES[canvasThemeId]
  const hl = useMemo(
    () =>
      getEffectiveHubLinkTheme(canvasThemeId, {
        hubLinksIntensityScale,
        hubLinksSpeedScale,
      }),
    [canvasThemeId, hubLinksIntensityScale, hubLinksSpeedScale]
  )
  const hubMotion = useMemo(
    () =>
      hubLinksMotionEffective({
        orchestratorHubLinksMotionEnabled,
        respectPrefersReducedMotion,
      }),
    [orchestratorHubLinksMotionEnabled, respectPrefersReducedMotion]
  )

  const autoFocusHighlight = useOrchestratorActivityStore((s) => s.autoFocusHighlight)
  const sessionToolDepthByKey = useOrchestratorActivityStore((s) => s.sessionToolDepthByKey)
  const agentTileFocus = useOrchestratorActivityStore((s) => s.agentTileFocus)

  const membersByTileId = useAgentTeamStore((s) => s.membersByTileId)

  const { hub, targets, bounds } = useMemo(() => {
    const list = Array.from(tilesMap.values()).filter((tile) => !isCanvasSuppressedTile(tile))
    const h = pickOrchestratorHub(list)
    if (!h) {
      return { hub: null as TileData | null, targets: [] as TileData[], bounds: null }
    }
    const t = list.filter((tile) => tile.id !== h.id)
    if (t.length === 0) {
      return { hub: h, targets: [], bounds: null }
    }
    const b = computeBounds([h, ...t])
    return { hub: h, targets: t, bounds: b }
  }, [tilesMap])

  if (!orchestratorHubLinksVisible) return null
  if (!hub || targets.length === 0 || !bounds) return null

  const hubCx = hub.x + hub.w / 2 - bounds.minX
  const hubCy = hub.y + hub.h / 2 - bounds.minY

  const flowDur = hl.flowDurationSec
  const sparkDur = hl.sparkDurationSec

  return (
    <svg
      className="orchestrator-hub-links pointer-events-none absolute z-[0] overflow-visible"
      width={bounds.width}
      height={bounds.height}
      style={{ left: bounds.minX, top: bounds.minY }}
      aria-hidden
    >
      {targets.map((tile, i) => {
        const tx = tile.x + tile.w / 2 - bounds.minX
        const ty = tile.y + tile.h / 2 - bounds.minY

        const highlight = autoFocusHighlight
        const srcKey = highlight
          ? sessionKeyForOrchestratorTileId(highlight.sourceSessionTileId ?? null)
          : ''
        const depthGlobal = highlight && srcKey ? (sessionToolDepthByKey[srcKey] ?? 0) : 0
        const lineActive =
          !!highlight &&
          highlight.tileId === tile.id &&
          depthGlobal > 0

        const focusAccent =
          lineActive &&
          agentTileFocus &&
          agentTileFocus.tileId === tile.id &&
          (agentTileFocus.action === 'reading' || agentTileFocus.action === 'writing')
            ? agentTileFocus.action === 'reading'
              ? ('read' as const)
              : ('write' as const)
            : null

        const sourceTile = highlight?.sourceSessionTileId
          ? tilesMap.get(highlight.sourceSessionTileId)
          : undefined

        /** Sub-agent chain: Orchestrator hub → Agent tile → Module tile (skip duplicate hub→agent on the agent tile row). */
        const subAgentModuleChain =
          lineActive &&
          sourceTile?.type === 'agent' &&
          highlight.tileId !== highlight.sourceSessionTileId

        const skipDuplicateHubToAgentLeg =
          !!highlight &&
          depthGlobal > 0 &&
          highlight.sourceSessionTileId === tile.id &&
          highlight.tileId !== highlight.sourceSessionTileId &&
          tilesMap.get(highlight.sourceSessionTileId)?.type === 'agent'

        if (skipDuplicateHubToAgentLeg) {
          return null
        }

        const rev = i % 2 === 1

        if (subAgentModuleChain && sourceTile) {
          const { x: ax, y: ay } = tileCenterInSvg(sourceTile, bounds)
          const stylesHubToAgent = hubLinkStylesForSource(null, tilesMap, canvas, hl)
          const stylesAgentToModule = hubLinkStylesForSource(
            highlight.sourceSessionTileId,
            tilesMap,
            canvas,
            hl
          )
          const flowOpacity = hl.activeOpacity
          const sparkOpacity = hl.activeOpacity * 0.92
          const accentStyles = hubLinkAccentStyles(focusAccent)
          const moduleStyles = accentStyles ?? stylesAgentToModule
          const pulseBoost = lineActive ? 1.65 : 1

          return (
            <g key={`${hub.id}-${tile.id}-subagent-chain`}>
              <HubLinkSegment
                x1={hubCx}
                y1={hubCy}
                x2={ax}
                y2={ay}
                styles={stylesHubToAgent}
                staggerIndex={i * 2}
                flowDur={flowDur}
                sparkDur={sparkDur}
                flowOpacity={flowOpacity}
                sparkOpacity={sparkOpacity}
                rev={rev}
                flowSpeedBoost={pulseBoost}
                motionEnabled={hubMotion}
              />
              <HubLinkSegment
                x1={ax}
                y1={ay}
                x2={tx}
                y2={ty}
                styles={moduleStyles}
                staggerIndex={i * 2 + 1}
                flowDur={flowDur}
                sparkDur={sparkDur}
                flowOpacity={flowOpacity}
                sparkOpacity={sparkOpacity}
                rev={!rev}
                flowSpeedBoost={pulseBoost}
                motionEnabled={hubMotion}
              />
            </g>
          )
        }

        const x1 = hubCx
        const y1 = hubCy

        const styleSourceId = lineActive
          ? highlight?.sourceSessionTileId
          : tile.type === 'agent'
            ? tile.id
            : null

        const baseStyles = hubLinkStylesForSource(styleSourceId, tilesMap, canvas, hl)
        const accentStyles = hubLinkAccentStyles(focusAccent)
        const styles = accentStyles ?? baseStyles

        const flowOpacity = lineActive ? hl.activeOpacity : hl.idleOpacity
        const sparkOpacity = lineActive ? hl.activeOpacity * 0.92 : hl.idleOpacity * 0.58
        const pulseBoost = lineActive ? 1.65 : 1

        // Delegation branch: if this tile was spawned by another on-canvas agent
        // (its "lead"), draw parent→worker instead of / in addition to hub→worker.
        const parentLinkId =
          tile.spawnedByTileId ??
          (tile.type === 'agent' ? membersByTileId[tile.id]?.parentTileId : undefined)
        const parentTile =
          delegationLineMode !== 'radial' && parentLinkId
            ? tilesMap.get(parentLinkId)
            : undefined
        const isBranchChild =
          !!parentTile &&
          parentTile.type === 'agent' &&
          parentTile.id !== hub.id &&
          parentTile.id !== tile.id
        if (isBranchChild && parentTile) {
          const { x: px, y: py } = tileCenterInSvg(parentTile, bounds)
          const branchStyles = hubLinkStylesForSource(parentTile.id, tilesMap, canvas, hl)
          const branchFinalStyles = accentStyles ?? branchStyles
          const childWorking =
            tile.type === 'agent' && membersByTileId[tile.id]?.status === 'working'
          const branchBoost = pulseBoost * (childWorking ? 1.22 : 1)
          const { d: branchD, len: branchLen } = delegationBranchPathD(px, py, tx, ty)
          return (
            <g key={`${hub.id}-${tile.id}-branch`}>
              {delegationLineMode === 'both' && (
                <HubLinkSegment
                  x1={x1}
                  y1={y1}
                  x2={tx}
                  y2={ty}
                  styles={styles}
                  staggerIndex={i}
                  flowDur={flowDur}
                  sparkDur={sparkDur}
                  flowOpacity={flowOpacity * 0.45}
                  sparkOpacity={sparkOpacity * 0.45}
                  rev={rev}
                  flowSpeedBoost={pulseBoost}
                  motionEnabled={hubMotion}
                />
              )}
              <HubLinkCurveSegment
                d={branchD}
                len={branchLen}
                styles={branchFinalStyles}
                staggerIndex={i}
                flowDur={flowDur}
                sparkDur={sparkDur}
                flowOpacity={flowOpacity}
                sparkOpacity={sparkOpacity}
                rev={rev}
                flowSpeedBoost={branchBoost}
                motionEnabled={hubMotion}
              />
            </g>
          )
        }

        return (
          <HubLinkSegment
            key={`${hub.id}-${tile.id}`}
            x1={x1}
            y1={y1}
            x2={tx}
            y2={ty}
            styles={styles}
            staggerIndex={i}
            flowDur={flowDur}
            sparkDur={sparkDur}
            flowOpacity={flowOpacity}
            sparkOpacity={sparkOpacity}
            rev={rev}
            flowSpeedBoost={pulseBoost}
            motionEnabled={hubMotion}
          />
        )
      })}
    </svg>
  )
}
