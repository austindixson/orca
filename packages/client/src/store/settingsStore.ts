import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sanitizeHermesApiKeyForStorage } from '../lib/hermes/hermesApiKey'
import {
  parseAndValidateHybridProviderConfig,
  type HybridProviderConfig,
  type HybridReasoningMode,
  type HybridRuntimeModePolicy,
} from '../lib/providerConfig'
import {
  type AuthProfileRecord,
  upsertAuthProfile,
  validateAuthProfile,
} from '../lib/orchestrator/oneShot/authProfileStore'
import type { TileType } from './canvasStore'

export type Provider =
  | 'openai'
  | 'openaiCodex'
  | 'anthropic'
  | 'ollama'
  | 'openrouter'
  | 'google'
  | 'xai'
  | 'zai'
  | 'llamacpp'
  | 'mistral'
  | 'azureOpenai'
  | 'githubCopilot'
  | 'googleVertex'
  | 'bedrock'
  /** Nous Hermes gateway (Responses API or Z.AI-compatible chat) — uses Settings → Integrations Hermes API fields. */
  | 'hermes'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  enabled: boolean
  /** OpenAI only: choose whether Orca should use desktop OAuth or an API key. */
  authMode?: 'oauth' | 'apiKey'
  /** Use OpenAI Responses API (`/v1/responses`) instead of chat/completions — for OpenAI and Azure OpenAI. */
  useResponsesApi?: boolean
  /** Azure OpenAI deployment id (path segment under `/openai/deployments/{name}/…`). */
  azureDeployment?: string
}

export interface ModelConfig {
  id: string
  provider: Provider
  name: string
  displayName: string
  supportsImages?: boolean
  supportsTools?: boolean
  isFree?: boolean
}

/** Cached row from `GET https://openrouter.ai/api/v1/models` (persisted for offline catalog). */
export type OpenRouterCatalogEntry = {
  id: string
  name: string
  contextLength?: number
  pricing?: { prompt?: string; completion?: string }
  supportsTools?: boolean
  description?: string
}

type OpenAiModelsResponse = {
  data?: Array<{ id?: string | null }>
}

export const OPENAI_CODEX_DEFAULT_MODEL_ID = 'codex-gpt-5.4'

const LEGACY_OPENAI_CODEX_MODEL_ID_MAP: Record<string, string> = {
  'gpt-5.2-codex': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'gpt-5.1': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'gpt-5.1-codex': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'gpt-5.1-codex-max': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'gpt-5.1-codex-mini': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'gpt-5-codex': OPENAI_CODEX_DEFAULT_MODEL_ID,
  'codex-mini-latest': OPENAI_CODEX_DEFAULT_MODEL_ID,
}

export function migrateLegacyOpenAiCodexModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null
  return LEGACY_OPENAI_CODEX_MODEL_ID_MAP[modelId] ?? modelId
}

function resolveSelectedModelForProviderConfig(
  modelId: string | null | undefined,
  providers: Record<Provider, ProviderConfig>
): string | null {
  const migrated = migrateLegacyOpenAiCodexModelId(modelId)
  if (!migrated) return null
  if (migrated.startsWith('openai-custom-') && providers.openai.authMode === 'oauth') {
    return providers.openaiCodex.enabled ? OPENAI_CODEX_DEFAULT_MODEL_ID : null
  }
  const cfg = DEFAULT_MODELS.find((m) => m.id === migrated)
  if (!cfg) return migrated
  if (cfg.provider === 'openai' && providers.openai.authMode === 'oauth') {
    return providers.openaiCodex.enabled ? OPENAI_CODEX_DEFAULT_MODEL_ID : null
  }
  if (cfg.provider === 'openaiCodex' && !providers.openaiCodex.enabled) {
    return providers.openai.authMode !== 'oauth' ? 'gpt-5.4' : null
  }
  return migrated
}

export type HybridRuntimePolicies = HybridProviderConfig['runtimePolicies']

export const DEFAULT_HYBRID_RUNTIME_POLICIES: HybridRuntimePolicies = {
  localOrchestrator: {
    providerId: 'local-gateway',
    modelId: 'gpt-5.4-mini',
    reasoningMode: 'fast',
    allowFallback: true,
  },
  hermesLead: {
    providerId: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4',
    reasoningMode: 'expert',
    allowFallback: true,
  },
}

function cloneHybridRuntimePolicies(v: HybridRuntimePolicies): HybridRuntimePolicies {
  return {
    localOrchestrator: { ...v.localOrchestrator },
    hermesLead: { ...v.hermesLead },
  }
}

function normalizeHybridReasoningMode(
  raw: unknown,
  fallback: HybridReasoningMode = 'auto'
): HybridReasoningMode {
  return raw === 'auto' || raw === 'fast' || raw === 'expert' || raw === 'heavy' ? raw : fallback
}

function normalizeHybridRuntimeModePolicy(
  raw: unknown,
  fallback: HybridRuntimeModePolicy
): HybridRuntimeModePolicy {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const r = raw as Record<string, unknown>
  return {
    providerId:
      typeof r.providerId === 'string' && r.providerId.trim().length > 0
        ? r.providerId.trim()
        : fallback.providerId,
    modelId:
      typeof r.modelId === 'string' && r.modelId.trim().length > 0 ? r.modelId.trim() : fallback.modelId,
    reasoningMode: normalizeHybridReasoningMode(r.reasoningMode, fallback.reasoningMode),
    allowFallback: typeof r.allowFallback === 'boolean' ? r.allowFallback : fallback.allowFallback,
  }
}

export function normalizeHybridRuntimePolicies(
  raw: unknown,
  fallback: HybridRuntimePolicies = DEFAULT_HYBRID_RUNTIME_POLICIES
): HybridRuntimePolicies {
  const fb = cloneHybridRuntimePolicies(fallback)
  if (!raw || typeof raw !== 'object') return fb
  const r = raw as Record<string, unknown>
  return {
    localOrchestrator: normalizeHybridRuntimeModePolicy(r.localOrchestrator, fb.localOrchestrator),
    hermesLead: normalizeHybridRuntimeModePolicy(r.hermesLead, fb.hermesLead),
  }
}

export function validateHybridRuntimePolicyRefs(config: HybridProviderConfig): string[] {
  const errors: string[] = []
  const providerMap = new Map(config.providers.map((p) => [p.id, p] as const))
  for (const mode of ['localOrchestrator', 'hermesLead'] as const) {
    const policy = config.runtimePolicies[mode]
    const provider = providerMap.get(policy.providerId)
    if (!provider) {
      errors.push(`runtimePolicies.${mode}.providerId references unknown provider: ${policy.providerId}`)
      continue
    }
    const model = provider.models.find((m) => m.id === policy.modelId)
    if (!model) {
      errors.push(
        `runtimePolicies.${mode}.modelId references unknown model '${policy.modelId}' for provider '${provider.id}'`
      )
      continue
    }
    if (!model.reasoningModes.includes(policy.reasoningMode)) {
      errors.push(
        `runtimePolicies.${mode}.reasoningMode '${policy.reasoningMode}' is not supported by model '${policy.modelId}'`
      )
    }
  }
  return errors
}

export function resolveHybridProviderConfigState(
  rawJson: unknown,
  fallbackPolicies: HybridRuntimePolicies = DEFAULT_HYBRID_RUNTIME_POLICIES
): {
  hybridProviderConfigJson: string
  hybridRuntimePolicies: HybridRuntimePolicies
  hybridProviderConfigErrors: string[]
  hybridProviderConfig: HybridProviderConfig | null
} {
  const normalizedJson = typeof rawJson === 'string' ? rawJson.trim() : ''
  const fallback = normalizeHybridRuntimePolicies(fallbackPolicies, DEFAULT_HYBRID_RUNTIME_POLICIES)
  if (!normalizedJson) {
    return {
      hybridProviderConfigJson: '',
      hybridRuntimePolicies: fallback,
      hybridProviderConfigErrors: [],
      hybridProviderConfig: null,
    }
  }
  const parsed = parseAndValidateHybridProviderConfig(normalizedJson)
  if (!parsed.ok) {
    return {
      hybridProviderConfigJson: normalizedJson,
      hybridRuntimePolicies: fallback,
      hybridProviderConfigErrors: parsed.errors,
      hybridProviderConfig: null,
    }
  }
  const refErrors = validateHybridRuntimePolicyRefs(parsed.value)
  if (refErrors.length > 0) {
    return {
      hybridProviderConfigJson: normalizedJson,
      hybridRuntimePolicies: fallback,
      hybridProviderConfigErrors: refErrors,
      hybridProviderConfig: null,
    }
  }
  return {
    hybridProviderConfigJson: normalizedJson,
    hybridRuntimePolicies: cloneHybridRuntimePolicies(parsed.value.runtimePolicies),
    hybridProviderConfigErrors: [],
    hybridProviderConfig: parsed.value,
  }
}

function normalizeHybridAuthProfileRecord(raw: unknown): AuthProfileRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<AuthProfileRecord>
  const lane = r.lane
  if (lane !== 'oauth' && lane !== 'browser_session' && lane !== 'hybrid') return null

  const normalized: AuthProfileRecord = {
    id: typeof r.id === 'string' ? r.id.trim() : '',
    appId: typeof r.appId === 'string' ? r.appId.trim() : '',
    lane,
    createdAt: typeof r.createdAt === 'string' && r.createdAt.trim() ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt.trim() ? r.updatedAt : new Date().toISOString(),
    oauth: r.oauth
      ? {
          tokenRef: typeof r.oauth.tokenRef === 'string' ? r.oauth.tokenRef.trim() : '',
          scopeFingerprint:
            typeof r.oauth.scopeFingerprint === 'string' && r.oauth.scopeFingerprint.trim()
              ? r.oauth.scopeFingerprint.trim()
              : undefined,
          lastRefreshAt:
            typeof r.oauth.lastRefreshAt === 'string' && r.oauth.lastRefreshAt.trim()
              ? r.oauth.lastRefreshAt.trim()
              : undefined,
        }
      : undefined,
    browserSession: r.browserSession
      ? {
          sessionBundleRef:
            typeof r.browserSession.sessionBundleRef === 'string'
              ? r.browserSession.sessionBundleRef.trim()
              : '',
          runtimeFingerprintRef:
            typeof r.browserSession.runtimeFingerprintRef === 'string'
              ? r.browserSession.runtimeFingerprintRef.trim()
              : '',
          domainBindings: Array.isArray(r.browserSession.domainBindings)
            ? Array.from(new Set(r.browserSession.domainBindings.map((d) => String(d).trim()).filter(Boolean)))
            : [],
          healthState:
            r.browserSession.healthState === 'healthy' ||
            r.browserSession.healthState === 'expiring' ||
            r.browserSession.healthState === 'invalid'
              ? r.browserSession.healthState
              : 'invalid',
          lastHealthCheckAt:
            typeof r.browserSession.lastHealthCheckAt === 'string' && r.browserSession.lastHealthCheckAt.trim()
              ? r.browserSession.lastHealthCheckAt.trim()
              : undefined,
        }
      : undefined,
    hybrid: r.hybrid
      ? {
          preferredOrder: Array.isArray(r.hybrid.preferredOrder)
            ? r.hybrid.preferredOrder.filter((v): v is 'oauth' | 'browser_session' =>
                v === 'oauth' || v === 'browser_session'
              )
            : [],
        }
      : undefined,
  }

  return validateAuthProfile(normalized).length === 0 ? normalized : null
}

export function normalizeHybridAuthProfiles(
  raw: unknown,
  fallback: AuthProfileRecord[] = []
): AuthProfileRecord[] {
  if (!Array.isArray(raw)) return [...fallback]
  const out: AuthProfileRecord[] = []
  for (const row of raw) {
    const normalized = normalizeHybridAuthProfileRecord(row)
    if (normalized) out.push(normalized)
  }
  return out
}

/** Active panel in the Settings modal (sidebar). */
export type SettingsSectionId = 'models' | 'appearance' | 'canvas' | 'agent' | 'integrations'

/** Orchestrator prompt articulation: infer clear intent before decomposition / hierarchy. */
export type OrchestratorArticulationMode = 'off' | 'before_planning' | 'always'

export function normalizeOrchestratorArticulationMode(v: unknown): OrchestratorArticulationMode {
  if (v === 'off' || v === 'before_planning' || v === 'always') return v
  return 'before_planning'
}

/**
 * How 1-shot Phase 3 builds `ARCHITECTURE.html`.
 * **cocoon_ai** follows [Cocoon AI Architecture Diagram Generator](https://github.com/Cocoon-AI/architecture-diagram-generator) (dark SVG, semantic colors).
 * **visual_explainer** uses Mermaid + module cards (Orca visual-explainer–style HTML).
 */
export type OneShotArchitectureDiagramMode = 'cocoon_ai' | 'visual_explainer'

export type CanvasThemeId = 'orca' | 'midnightBloom' | 'graphiteLab' | 'pastelMist'

/** Where to load long-term markdown for the orchestrator prompt (Hermes-style MEMORY.md). */
export type OrcaMemoryLongTermSourceId = 'workspace' | 'user' | 'both'

/** Where to load USER.md for the orchestrator prompt (same shape as memory source). */
export type OrcaUserProfileSourceId = OrcaMemoryLongTermSourceId

/** Autonomy: standard = confirm risky actions; broad = wide latitude with explicit red lines. */
export type OrchestratorAutonomyMode = 'standard' | 'broad'

export function normalizeOrchestratorAutonomyMode(v: unknown): OrchestratorAutonomyMode {
  if (v === 'broad' || v === 'standard') return v
  return 'standard'
}

/** App chrome accents + glows (orthogonal to canvas dot/particle theme). */
export type UiThemeId = 'default' | 'pastel'

/** Primary hybrid shell UX: persistent side chat vs spotlight launcher quick input. */
export type HybridGuiShellMode = 'desktop_sidebar' | 'spotlight_launcher'

/** Tile border: shooting-star light circling the edge (single or dual highlights). */
export type TileBorderAnimationId = 'off' | 'single' | 'double'

/** Narrator line generation mode for the canvas HUD. */
export type NarratorMode = 'template' | 'ai'

/** Visual effects bundle: clean = minimal motion; default = standard Orca; custom = user-tuned. */
export type VisualEffectsPresetId = 'default' | 'clean' | 'custom'
export type OrchestratorDelegationLineMode = 'branch' | 'radial' | 'both'
const ORCHESTRATOR_DELEGATION_LINE_MODES: OrchestratorDelegationLineMode[] = [
  'branch',
  'radial',
  'both',
]
function normalizeOrchestratorDelegationLineMode(
  v: unknown,
  fallback: OrchestratorDelegationLineMode = 'branch'
): OrchestratorDelegationLineMode {
  return typeof v === 'string' &&
    ORCHESTRATOR_DELEGATION_LINE_MODES.includes(v as OrchestratorDelegationLineMode)
    ? (v as OrchestratorDelegationLineMode)
    : fallback
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Hub link theme after intensity/speed scales (motion handled in OrchestratorHubLinks). */
export function getEffectiveHubLinkTheme(
  canvasThemeId: CanvasThemeId,
  s: { hubLinksIntensityScale: number; hubLinksSpeedScale: number }
): HubLinkThemeConfig {
  const base = CANVAS_THEMES[normalizeCanvasThemeId(canvasThemeId)].hubLinks
  const intensity = Math.min(1.5, Math.max(0, s.hubLinksIntensityScale))
  const speed = Math.min(2, Math.max(0.45, s.hubLinksSpeedScale))
  return {
    idleOpacity: clamp01(base.idleOpacity * intensity),
    activeOpacity: clamp01(base.activeOpacity * intensity),
    trackOpacity: clamp01(base.trackOpacity * intensity),
    vibrance: clamp01(base.vibrance * intensity),
    saturation: base.saturation,
    flowDurationSec: base.flowDurationSec / speed,
    sparkDurationSec: base.sparkDurationSec / speed,
  }
}

export const VISUAL_EFFECTS_DEFAULTS = {
  visualEffectsPreset: 'default' as VisualEffectsPresetId,
  orchestratorHubLinksVisible: true,
  orchestratorHubLinksMotionEnabled: true,
  hubLinksIntensityScale: 1,
  hubLinksSpeedScale: 1,
  tileIdleGlowEnabled: true,
  tileIdleGlowStrength: 1,
  shootingStarSpeedScale: 1,
  /** When true, tile shooting-star border also respects `prefers-reduced-motion` (independent of hub/reveal). */
  shootingStarsHonorReducedMotion: false,
  respectPrefersReducedMotion: false,
  /** Global policy: animate only active/focused tile surfaces. */
  onlyAnimateFocusedTile: true,
  orchestratorTileRevealEffectsEnabled: true,
  editorAgentLineAnimationsEnabled: false,
} as const

/** Hub dash/spark animation allowed (settings + optional system reduced-motion). */
export function hubLinksMotionEffective(s: {
  orchestratorHubLinksMotionEnabled: boolean
  respectPrefersReducedMotion: boolean
}): boolean {
  if (!s.orchestratorHubLinksMotionEnabled) return false
  if (typeof window === 'undefined') return true
  try {
    if (s.respectPrefersReducedMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false
    }
  } catch {
    /* ignore */
  }
  return true
}

export interface TilePickerPreference {
  visible: boolean
  favorite: boolean
}

const TILE_PICKER_TYPES: TileType[] = [
  'terminal',
  'editor',
  'browser',
  'github',
  'diff',
  'todo',
  'agent',
  'agent_team',
  'changelog',
  'orchestrator',
  'benchmark',
  'remotion',
  'openrouter_usage',
  'toolbox',
  'research',
  'reasoning',
  'project_status',
  'hermes_agent',
]

const DEFAULT_FAVORITE_TILES = new Set<TileType>(['agent', 'terminal', 'editor', 'browser', 'remotion'])

function defaultTilePickerPreferences(): Record<TileType, TilePickerPreference> {
  const out = {} as Record<TileType, TilePickerPreference>
  for (const type of TILE_PICKER_TYPES) {
    out[type] = {
      visible: true,
      favorite: DEFAULT_FAVORITE_TILES.has(type),
    }
  }
  return out
}

function normalizeTilePickerPreferences(
  input: unknown,
  fallback: Record<TileType, TilePickerPreference>
): Record<TileType, TilePickerPreference> {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const out = {} as Record<TileType, TilePickerPreference>
  for (const type of TILE_PICKER_TYPES) {
    const row = obj[type]
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    out[type] = {
      visible:
        typeof rec.visible === 'boolean'
          ? rec.visible
          : fallback[type]?.visible ?? true,
      favorite:
        typeof rec.favorite === 'boolean'
          ? rec.favorite
          : fallback[type]?.favorite ?? DEFAULT_FAVORITE_TILES.has(type),
    }
  }
  return out
}

function defaultTilePickerAddCounts(): Record<TileType, number> {
  const out = {} as Record<TileType, number>
  for (const type of TILE_PICKER_TYPES) {
    out[type] = 0
  }
  return out
}

/** Persisted add counts from the Add tile menu (for ordering favorites: most used nearest the trigger). */
function normalizeTilePickerAddCounts(
  input: unknown,
  fallback: Record<TileType, number>
): Record<TileType, number> {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const out = {} as Record<TileType, number>
  for (const type of TILE_PICKER_TYPES) {
    const n = obj[type]
    const v =
      typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : (fallback[type] ?? 0)
    out[type] = v
  }
  return out
}

/** Orchestrator hub → module connection lines (animated SVG). Tuned per canvas theme. */
export interface HubLinkThemeConfig {
  /** Flow + spark opacity when idle (0–1) */
  idleOpacity: number
  /** Flow + spark opacity when a tool targets this link (0–1) */
  activeOpacity: number
  /** Multiplier for HSL saturation on agent-colored segments (0.55–1.25) */
  saturation: number
  /** Glow strength — scales drop-shadow blur and alpha (0–1) */
  vibrance: number
  /** Underlay “track” line opacity (0–1) */
  trackOpacity: number
  /** Main dashed flow animation duration (seconds) */
  flowDurationSec: number
  /** Bright spark layer duration (seconds) */
  sparkDurationSec: number
}

export interface CanvasThemeConfig {
  id: CanvasThemeId
  name: string
  description: string
  canvasBg: string
  dotRgba: string
  particleLineRgb: string
  particleDotRgb: string
  particleAccentRgb: string
  hubLinks: HubLinkThemeConfig
}

export const CANVAS_THEMES: Record<CanvasThemeId, CanvasThemeConfig> = {
  orca: {
    id: 'orca',
    name: 'Orca',
    description: 'Default dark neon canvas',
    canvasBg: '#0d0d12',
    dotRgba: '255,255,255,0.055',
    particleLineRgb: '145,190,245',
    particleDotRgb: '220,230,255',
    particleAccentRgb: '0,212,170',
    hubLinks: {
      idleOpacity: 0.52,
      activeOpacity: 1,
      saturation: 1,
      vibrance: 0.92,
      trackOpacity: 0.2,
      flowDurationSec: 1.28,
      sparkDurationSec: 0.85,
    },
  },
  midnightBloom: {
    id: 'midnightBloom',
    name: 'Midnight Bloom',
    description: 'Blue-violet cinematic night',
    canvasBg: '#0b0d19',
    dotRgba: '180,190,255,0.06',
    particleLineRgb: '164,167,255',
    particleDotRgb: '223,216,255',
    particleAccentRgb: '147,197,253',
    hubLinks: {
      idleOpacity: 0.48,
      activeOpacity: 1,
      saturation: 1.04,
      vibrance: 0.88,
      trackOpacity: 0.22,
      flowDurationSec: 1.32,
      sparkDurationSec: 0.88,
    },
  },
  graphiteLab: {
    id: 'graphiteLab',
    name: 'Graphite Lab',
    description: 'Neutral graphite with cool cyan accents',
    canvasBg: '#101115',
    dotRgba: '205,215,230,0.05',
    particleLineRgb: '170,188,210',
    particleDotRgb: '224,234,245',
    particleAccentRgb: '34,211,238',
    hubLinks: {
      idleOpacity: 0.4,
      activeOpacity: 0.98,
      saturation: 0.9,
      vibrance: 0.72,
      trackOpacity: 0.17,
      flowDurationSec: 1.45,
      sparkDurationSec: 0.95,
    },
  },
  /**
   * Harmonious muted palette (slate base + lavender + sage accents).
   * Inspired by trending Coolors.co “soft dark” / analogous groupings — see https://coolors.co
   */
  pastelMist: {
    id: 'pastelMist',
    name: 'Pastel Mist',
    description: 'Cool slate, soft lavender, sage — low-contrast canvas',
    canvasBg: '#1a1b2e',
    dotRgba: '180,190,255,0.045',
    particleLineRgb: '148,163,184',
    particleDotRgb: '203,213,225',
    particleAccentRgb: '125,170,160',
    hubLinks: {
      idleOpacity: 0.58,
      activeOpacity: 0.94,
      saturation: 0.72,
      vibrance: 0.48,
      trackOpacity: 0.14,
      flowDurationSec: 1.62,
      sparkDurationSec: 1.08,
    },
  },
}

/** Maps persisted canvas theme ids; legacy `nyx` was renamed to `orca`. */
export function normalizeCanvasThemeId(input: unknown): CanvasThemeId {
  if (input === 'nyx') return 'orca'
  if (typeof input === 'string' && input in CANVAS_THEMES) {
    return input as CanvasThemeId
  }
  return 'orca'
}

function normalizeUiThemeId(input: unknown): UiThemeId {
  return input === 'pastel' ? 'pastel' : 'default'
}

export function normalizeHybridGuiShellMode(input: unknown): HybridGuiShellMode {
  return input === 'spotlight_launcher' ? 'spotlight_launcher' : 'desktop_sidebar'
}

function normalizeTileBorderAnimationId(input: unknown): TileBorderAnimationId {
  if (input === 'single' || input === 'double') return input
  return 'off'
}

function normalizeVisualEffectsPresetId(input: unknown): VisualEffectsPresetId {
  if (input === 'clean' || input === 'custom' || input === 'default') return input
  return 'default'
}

function normalizeHubScale(input: unknown, fallback: number, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.min(max, Math.max(min, input))
}

export const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'gpt-5.4', provider: 'openai', name: 'gpt-5.4', displayName: 'GPT-5.4', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.4-mini', provider: 'openai', name: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.4-nano', provider: 'openai', name: 'gpt-5.4-nano', displayName: 'GPT-5.4 Nano', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.2', provider: 'openai', name: 'gpt-5.2', displayName: 'GPT-5.2', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.2-pro', provider: 'openai', name: 'gpt-5.2-pro', displayName: 'GPT-5.2 Pro', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.1', provider: 'openai', name: 'gpt-5.1', displayName: 'GPT-5.1', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.1-chat-latest', provider: 'openai', name: 'gpt-5.1-chat-latest', displayName: 'GPT-5.1 Chat', supportsImages: true, supportsTools: true },
  { id: 'gpt-5', provider: 'openai', name: 'gpt-5', displayName: 'GPT-5', supportsImages: true, supportsTools: true },
  { id: 'gpt-5-pro', provider: 'openai', name: 'gpt-5-pro', displayName: 'GPT-5 Pro', supportsImages: true, supportsTools: true },
  { id: 'gpt-5-mini', provider: 'openai', name: 'gpt-5-mini', displayName: 'GPT-5 Mini', supportsImages: true, supportsTools: true },
  { id: 'gpt-5-nano', provider: 'openai', name: 'gpt-5-nano', displayName: 'GPT-5 Nano', supportsImages: true, supportsTools: true },
  { id: 'gpt-5-chat-latest', provider: 'openai', name: 'gpt-5-chat-latest', displayName: 'GPT-5 Chat', supportsImages: true, supportsTools: true },
  { id: 'gpt-5.2-chat-latest', provider: 'openai', name: 'gpt-5.2-chat-latest', displayName: 'GPT-5.2 Chat', supportsImages: true, supportsTools: true },
  { id: 'o3-pro', provider: 'openai', name: 'o3-pro', displayName: 'o3 Pro', supportsImages: true, supportsTools: true },
  { id: 'o3', provider: 'openai', name: 'o3', displayName: 'o3', supportsImages: true, supportsTools: true },
  { id: 'o4-mini', provider: 'openai', name: 'o4-mini', displayName: 'o4 Mini', supportsImages: true, supportsTools: true },
  { id: 'o3-mini', provider: 'openai', name: 'o3-mini', displayName: 'o3 Mini', supportsImages: true, supportsTools: true },
  { id: 'o1-pro', provider: 'openai', name: 'o1-pro', displayName: 'o1 Pro', supportsImages: true, supportsTools: true },
  { id: 'o1', provider: 'openai', name: 'o1', displayName: 'o1', supportsImages: true, supportsTools: true },
  { id: 'gpt-4.1', provider: 'openai', name: 'gpt-4.1', displayName: 'GPT-4.1', supportsImages: true, supportsTools: true },
  { id: 'gpt-4.1-mini', provider: 'openai', name: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini', supportsImages: true, supportsTools: true },
  { id: 'gpt-4.1-nano', provider: 'openai', name: 'gpt-4.1-nano', displayName: 'GPT-4.1 Nano', supportsImages: true, supportsTools: true },
  { id: 'gpt-4o', provider: 'openai', name: 'gpt-4o', displayName: 'GPT-4o', supportsImages: true, supportsTools: true },
  { id: 'chatgpt-4o-latest', provider: 'openai', name: 'chatgpt-4o-latest', displayName: 'ChatGPT-4o', supportsImages: true, supportsTools: true },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'gpt-4o-mini', displayName: 'GPT-4o Mini', supportsImages: true, supportsTools: true },
  { id: 'gpt-4-turbo', provider: 'openai', name: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', supportsImages: true, supportsTools: true },
  { id: OPENAI_CODEX_DEFAULT_MODEL_ID, provider: 'openaiCodex', name: 'gpt-5.4', displayName: 'GPT-5.4 (Codex)', supportsImages: true, supportsTools: true },
  { id: 'codex-gpt-5.4-mini', provider: 'openaiCodex', name: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini (Codex)', supportsImages: true, supportsTools: true },
  { id: 'codex-gpt-5.2', provider: 'openaiCodex', name: 'gpt-5.2', displayName: 'GPT-5.2 (Codex)', supportsImages: true, supportsTools: true },
  {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    name: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'claude-opus-4-20250514',
    provider: 'anthropic',
    name: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'claude-3-opus',
    provider: 'anthropic',
    name: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'claude-3-haiku',
    provider: 'anthropic',
    name: 'claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    supportsImages: true,
    supportsTools: true,
  },
  { id: 'gemini-pro', provider: 'google', name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportsImages: true },
  { id: 'gemini-flash', provider: 'google', name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', supportsImages: true },
]

/** xAI OpenAI-compatible API base (`https://api.x.ai/v1`). */
export const XAI_DEFAULT_BASE = 'https://api.x.ai/v1'

/** Baseline Grok models (xAI quickstart examples). */
export const XAI_MODELS: ModelConfig[] = [
  {
    id: 'xai-grok-4-20-reasoning',
    provider: 'xai',
    name: 'grok-4.20-reasoning',
    displayName: 'Grok 4.20 Reasoning',
    supportsImages: true,
    supportsTools: true,
  },
  {
    id: 'xai-grok-4',
    provider: 'xai',
    name: 'grok-4',
    displayName: 'Grok 4',
    supportsImages: true,
    supportsTools: true,
  },
]

function titleCaseToken(token: string): string {
  if (!token) return token
  if (/^\d/.test(token)) return token
  return token.charAt(0).toUpperCase() + token.slice(1)
}

function formatOpenAiModelDisplayName(name: string): string {
  const normalized = name.trim()
  if (!normalized) return 'OpenAI model'
  return normalized
    .split(/[-_]/g)
    .map((token) => {
      if (/^(gpt|chatgpt)$/i.test(token)) return token.toUpperCase()
      if (/^o[134]$/i.test(token)) return token.toLowerCase()
      if (/^mini$/i.test(token)) return 'Mini'
      if (/^nano$/i.test(token)) return 'Nano'
      if (/^preview$/i.test(token)) return 'Preview'
      if (/^latest$/i.test(token)) return 'Latest'
      return titleCaseToken(token)
    })
    .join(' ')
}

function shouldIncludeOpenAiModel(name: string): boolean {
  const id = name.trim().toLowerCase()
  if (!id) return false
  if (
    id.startsWith('text-embedding') ||
    id.startsWith('text-moderation') ||
    id.startsWith('omni-moderation') ||
    id.startsWith('whisper-') ||
    id.startsWith('tts-') ||
    id.startsWith('dall-e-') ||
    id.startsWith('gpt-image-') ||
    id.startsWith('davinci-') ||
    id.startsWith('babbage-')
  ) {
    return false
  }
  return /^(gpt|chatgpt|o1|o3|o4|codex)/i.test(id)
}

function inferOpenAiModelTraits(name: string): Pick<ModelConfig, 'supportsImages' | 'supportsTools'> {
  const id = name.toLowerCase()
  const supportsImages =
    /(gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|chatgpt)/i.test(id) && !/(audio|realtime|transcribe)/i.test(id)
  const supportsTools = /^(gpt|chatgpt|o1|o3|o4|codex)/i.test(id)
  return { supportsImages, supportsTools }
}

export function normalizeOpenAiDiscoveredModels(payload: OpenAiModelsResponse): ModelConfig[] {
  const raw = Array.isArray(payload?.data) ? payload.data : []
  const deduped = new Map<string, ModelConfig>()
  for (const row of raw) {
    const name = typeof row?.id === 'string' ? row.id.trim() : ''
    if (!shouldIncludeOpenAiModel(name)) continue
    const safeId = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    deduped.set(name, {
      id: `openai-${safeId}`,
      provider: 'openai',
      name,
      displayName: formatOpenAiModelDisplayName(name),
      ...inferOpenAiModelTraits(name),
    })
  }
  return [...deduped.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

function mergeProviderModels(base: ModelConfig[], extra: ModelConfig[]): ModelConfig[] {
  const merged = [...base]
  const seen = new Set(base.map((m) => `${m.provider}:${m.name}`))
  for (const model of extra) {
    const key = `${model.provider}:${model.name}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(model)
  }
  return merged
}

const OPENAI_INPUT_COST_PER_MTOK: Record<string, number> = {
  'gpt-5.2-pro': 21,
  'o3-pro': 20,
  'gpt-5-pro': 15,
  'chatgpt-4o-latest': 5,
  'gpt-5.4': 2.5,
  'gpt-4o': 2.5,
  'gpt-4.1': 2,
  'gpt-5.2': 1.75,
  'gpt-5.2-chat-latest': 1.75,
  'gpt-5.2-codex': 1.75,
  'gpt-5.1': 1.25,
  'gpt-5': 1.25,
  'gpt-5.1-chat-latest': 1.25,
  'gpt-5-chat-latest': 1.25,
  'gpt-5.1-codex-max': 1.25,
  'gpt-5.1-codex': 1.25,
  'gpt-5-codex': 1.25,
  'o4-mini': 1.1,
  'o3-mini': 1.1,
  'gpt-5.4-mini': 0.75,
  'gpt-5-mini': 0.25,
  'gpt-5.1-codex-mini': 0.25,
  'gpt-4.1-mini': 0.4,
  'gpt-5.4-nano': 0.2,
  'gpt-4o-mini': 0.15,
  'gpt-4.1-nano': 0.1,
  'gpt-5-nano': 0.05,
}

function isOpenAiCodingModel(name: string): boolean {
  return /^(gpt-5(?:\.|$)|gpt-5(?:\.\d+)?-(?:mini|nano|codex|chat-latest)|gpt-5\.1-codex(?:-max|-mini)?|gpt-5\.2-codex|codex-mini-latest)/i.test(
    name
  )
}

function compareOpenAiModels(a: ModelConfig, b: ModelConfig): number {
  const aCoding = isOpenAiCodingModel(a.name)
  const bCoding = isOpenAiCodingModel(b.name)
  if (aCoding !== bCoding) return aCoding ? -1 : 1
  const aCost = OPENAI_INPUT_COST_PER_MTOK[a.name] ?? -1
  const bCost = OPENAI_INPUT_COST_PER_MTOK[b.name] ?? -1
  if (aCost !== bCost) return bCost - aCost
  return a.displayName.localeCompare(b.displayName)
}

export function compareModelsForDisplay(a: ModelConfig, b: ModelConfig): number {
  const aTools = a.supportsTools !== false
  const bTools = b.supportsTools !== false
  if (aTools !== bTools) return aTools ? -1 : 1
  if ((a.provider === 'openai' || a.provider === 'openaiCodex') && (b.provider === 'openai' || b.provider === 'openaiCodex')) {
    return compareOpenAiModels(a, b)
  }
  if ((a.provider === 'openai' || a.provider === 'openaiCodex') && isOpenAiCodingModel(a.name)) return -1
  if ((b.provider === 'openai' || b.provider === 'openaiCodex') && isOpenAiCodingModel(b.name)) return 1
  const pa = PROVIDER_INFO[a.provider].name.localeCompare(PROVIDER_INFO[b.provider].name)
  if (pa !== 0) return pa
  return a.displayName.localeCompare(b.displayName)
}

export function sortModelsForDisplay(models: ModelConfig[]): ModelConfig[] {
  return [...models].sort(compareModelsForDisplay)
}

function normalizeCustomModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const item of raw) {
    const value = typeof item === 'string' ? item.trim() : ''
    if (!value) continue
    seen.add(value)
  }
  return [...seen]
}

function openAiCustomModelConfig(name: string): ModelConfig {
  const safeId = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return {
    id: `openai-custom-${safeId}`,
    provider: 'openai',
    name,
    displayName: `${formatOpenAiModelDisplayName(name)} (Custom)`,
    ...inferOpenAiModelTraits(name),
  }
}

/** Slug form `vendor/model` or `vendor/model:tag` (e.g. `:free`). */
export function openRouterCustomModelConfig(slug: string): ModelConfig {
  const t = slug.trim()
  const safeId = t.replace(/[^a-zA-Z0-9._-]/g, '_')
  const isFree = /:free$/i.test(t)
  return {
    id: `or-custom-${safeId}`,
    provider: 'openrouter',
    name: t,
    displayName: `${t} (Custom)`,
    supportsTools: true,
    ...(isFree ? { isFree: true } : {}),
  }
}

function normalizeOpenRouterCatalogPersisted(raw: unknown): OpenRouterCatalogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: OpenRouterCatalogEntry[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!id) continue
    const name = typeof r.name === 'string' ? r.name : id
    const contextLength =
      typeof r.contextLength === 'number' && Number.isFinite(r.contextLength)
        ? r.contextLength
        : undefined
    const description = typeof r.description === 'string' ? r.description : undefined
    const supportsTools = typeof r.supportsTools === 'boolean' ? r.supportsTools : undefined
    let pricing: OpenRouterCatalogEntry['pricing']
    if (r.pricing && typeof r.pricing === 'object') {
      const p = r.pricing as Record<string, unknown>
      const prompt =
        typeof p.prompt === 'string' ? p.prompt : typeof p.prompt === 'number' ? String(p.prompt) : undefined
      const completion =
        typeof p.completion === 'string'
          ? p.completion
          : typeof p.completion === 'number'
            ? String(p.completion)
            : undefined
      pricing = { prompt, completion }
    }
    out.push({ id, name, contextLength, pricing, supportsTools, description })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function normalizeOpenRouterCatalogResponse(raw: unknown): OpenRouterCatalogEntry[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: OpenRouterCatalogEntry[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!id) continue
    const name = typeof r.name === 'string' ? r.name : id
    const contextLength =
      typeof r.context_length === 'number' && Number.isFinite(r.context_length)
        ? r.context_length
        : undefined
    const description = typeof r.description === 'string' ? r.description : undefined
    let pricing: OpenRouterCatalogEntry['pricing']
    if (r.pricing && typeof r.pricing === 'object') {
      const p = r.pricing as Record<string, unknown>
      const prompt =
        typeof p.prompt === 'string' ? p.prompt : typeof p.prompt === 'number' ? String(p.prompt) : undefined
      const completion =
        typeof p.completion === 'string'
          ? p.completion
          : typeof p.completion === 'number'
            ? String(p.completion)
            : undefined
      pricing = { prompt, completion }
    }
    out.push({ id, name, contextLength, pricing, description })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export const OPENROUTER_MODELS: ModelConfig[] = [
  {
    id: 'or-minimax-m2-5-free',
    provider: 'openrouter',
    name: 'minimax/minimax-m2.5:free',
    displayName: 'MiniMax M2.5 (OR)',
    supportsImages: false,
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'or-xai-grok-code-fast-1',
    provider: 'openrouter',
    name: 'x-ai/grok-code-fast-1',
    displayName: 'Grok 1 Code Fast (OR)',
    supportsTools: true,
  },
  {
    id: 'or-free-router',
    provider: 'openrouter',
    name: 'openrouter/free',
    displayName: 'OpenRouter Free Router',
    supportsImages: true,
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'or-gemma-3-12b-free',
    provider: 'openrouter',
    name: 'google/gemma-3-12b-it:free',
    displayName: 'Gemma 3 12B (OR)',
    supportsImages: true,
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'or-gemma-4-31b-free',
    provider: 'openrouter',
    name: 'google/gemma-4-31b-it-20260402:free',
    displayName: 'Gemma 4 31B (OR)',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'or-nemotron-3-super-free',
    provider: 'openrouter',
    name: 'nvidia/nemotron-3-super-120b-a12b:free',
    displayName: 'NVIDIA Nemotron 3 Super (OR)',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'or-gemma-4-26b-free',
    provider: 'openrouter',
    name: 'google/gemma-4-26b-a4b-it:free',
    displayName: 'Gemma 4 26B (OR)',
    supportsTools: true,
    isFree: true,
  },
]

export function isBuiltinOpenRouterModelSlug(slug: string): boolean {
  const t = slug.trim()
  return OPENROUTER_MODELS.some((m) => m.name === t)
}

/** OpenRouter API base URL (default unless user explicitly edits in Settings). */
export const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1'
/** OpenAI Codex backend base (Pi-compatible ChatGPT OAuth transport). */
export const OPENAI_CODEX_DEFAULT_BASE = 'https://chatgpt.com/backend-api'

/**
 * Z.AI Coding Plan API base — your key determines which endpoint works.
 * - Coding Plan keys: `https://api.z.ai/api/coding/paas/v4` (glm-4.5, 4.6, 4.7, 5, 5.1)
 * - Standard keys: `https://api.z.ai/api/paas/v4` (glm-4, glm-4-plus, etc.)
 * Auth: `ZAI_API_KEY` (official), or `GLM_API_KEY` (Hermes/OpenClaw compat).
 * Hermes `~/.hermes/.env`: set `ZAI_CODING_BASE_URL` to this URL for Coding Plan; Tauri `resolve_llm_base_url` defaults here when unset.
 */
export const ZAI_DEFAULT_BASE = 'https://api.z.ai/api/coding/paas/v4'

/** Standard (non-Coding) endpoint — use if your key is for standard API. */
export const ZAI_STANDARD_BASE = 'https://api.z.ai/api/paas/v4'

/**
 * Migrate legacy persisted base URL: general PaaS (`/api/paas/v4`) does not bill Coding Plan quota;
 * default Orca models use Coding Plan — see {@link ZAI_DEFAULT_BASE}.
 */
export function migrateZaiBaseUrlToCoding(raw: string): string {
  const t = raw.trim().replace(/\/$/, '')
  if (!t) return ZAI_DEFAULT_BASE
  if (/^https?:\/\/api\.z\.ai\/api\/paas\/v4$/i.test(t)) {
    return ZAI_DEFAULT_BASE
  }
  return t
}

/**
 * Z.AI Coding Plan models — per official docs at https://docs.z.ai/devpack/tool/others
 * Available: GLM-5.1, GLM-5-Turbo, GLM-4.7, GLM-4.5-air
 * All support function calling via OpenAI protocol.
 */
export const ZAI_MODELS: ModelConfig[] = [
  { id: 'zai-glm-5-1', provider: 'zai', name: 'GLM-5.1', displayName: 'GLM-5.1' },
  { id: 'zai-glm-5-turbo', provider: 'zai', name: 'GLM-5-Turbo', displayName: 'GLM-5 Turbo' },
  { id: 'zai-glm-4-7', provider: 'zai', name: 'GLM-4.7', displayName: 'GLM-4.7' },
  { id: 'zai-glm-4-5-air', provider: 'zai', name: 'GLM-4.5-air', displayName: 'GLM-4.5 Air' },
  { id: 'zai-glm-5v-turbo', provider: 'zai', name: 'GLM-5V-Turbo', displayName: 'GLM-5V Turbo', supportsImages: true },
  { id: 'zai-glm-4-6v', provider: 'zai', name: 'GLM-4.6V', displayName: 'GLM-4.6V', supportsImages: true },
  { id: 'zai-glm-4-5v', provider: 'zai', name: 'GLM-4.5V', displayName: 'GLM-4.5V', supportsImages: true },
]
export const ZAI_DEFAULT_MODEL_ID = 'zai-glm-4-7'

/**
 * GLM Coding Plan tier (Z.AI) — drives concurrent chat/completions and sub-agent caps in the orchestrator.
 * See https://docs.z.ai/devpack/usage-policy (concurrency scales Lite &lt; Pro &lt; Max).
 */
export type ZaiPlanTier = 'lite' | 'pro' | 'max'
export const ZAI_HISTORICAL_SAFE_MIN_ROUND_MS = 150
export const ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS = 500

/** Concurrent Z.AI `chat/completions` calls allowed at once (replaces full serialization). */
export function zaiConcurrentChatLimitForTier(tier: ZaiPlanTier): number {
  switch (tier) {
    case 'lite':
      return 2
    case 'pro':
      return 4
    case 'max':
      return 8
    default:
      return 4
  }
}

/** Max concurrent `spawn_sub_agent` workers when the main orchestrator uses a Z.AI model. */
export function maxConcurrentSubAgentsForZaiTier(tier: ZaiPlanTier): number {
  return zaiConcurrentChatLimitForTier(tier)
}

export function normalizeZaiPlanTier(raw: unknown): ZaiPlanTier {
  if (raw === 'lite' || raw === 'pro' || raw === 'max') return raw
  return 'pro'
}

export function normalizeZaiMinMsBetweenRounds(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return ZAI_HISTORICAL_SAFE_MIN_ROUND_MS
  return Math.max(0, Math.min(2_000, Math.floor(n)))
}

export function normalizeZaiQueueMinGapMs(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS
  return Math.max(0, Math.min(2_000, Math.floor(n)))
}

/** llama.cpp default server URL (llama-server). */
export const LLAMACPP_DEFAULT_BASE = 'http://127.0.0.1:8000'

/** Hermes Agent API server (OpenAI-compatible); default port 8642. */
export const HERMES_API_DEFAULT_BASE = 'http://127.0.0.1:8642/v1'
export const HERMES_API_DEFAULT_MODEL = 'hermes-agent'

export function normalizeHermesApiBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '')
  if (!t) return HERMES_API_DEFAULT_BASE
  try {
    const u = new URL(t)
    // Legacy bug: we appended /v1 to Z.AI bases — strip …/paas/v4/v1 back to …/paas/v4.
    if (u.hostname === 'api.z.ai' && /\/paas\/v4\/v1$/i.test(u.pathname.replace(/\/$/, ''))) {
      return t.replace(/\/v1$/i, '').replace(/\/+$/, '')
    }
    // Z.AI OpenAI-compatible PaaS — chat is POST {base}/chat/completions (no /v1 segment).
    if (u.hostname === 'api.z.ai' && /\/paas\/v4$/i.test(u.pathname.replace(/\/$/, ''))) {
      return t
    }
  } catch {
    /* fall through */
  }
  if (/\/v1$/i.test(t)) return t
  return `${t}/v1`
}

/**
 * llama.cpp local models — from mac-code (walter-grace/mac-code).
 * These models run locally via llama-server with OpenAI-compatible API.
 * Recommended: Qwen3.5-35B-A3B (IQ2_M) — 30 tok/s on 16 GB Mac mini M4.
 */
export const LLAMACPP_MODELS: ModelConfig[] = [
  {
    id: 'llamacpp-qwen35-35b-a3b-iq2m',
    provider: 'llamacpp',
    name: 'Qwen3.5-35B-A3B-UD-IQ2_M',
    displayName: 'Qwen3.5 35B A3B (IQ2_M) — 30 tok/s',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'llamacpp-qwen35-9b-q4km',
    provider: 'llamacpp',
    name: 'Qwen3.5-9B-Q4_K_M',
    displayName: 'Qwen3.5 9B (Q4_K_M) — 16-20 tok/s',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'llamacpp-qwen3-30b-a3b-q4',
    provider: 'llamacpp',
    name: 'Qwen3-30B-A3B-Q4',
    displayName: 'Qwen3 30B A3B (Q4) — Expert Sniper',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'llamacpp-qwen35-35b-a3b-q4',
    provider: 'llamacpp',
    name: 'Qwen3.5-35B-A3B-Q4',
    displayName: 'Qwen3.5 35B A3B (Q4) — Expert Sniper',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'llamacpp-qwen35-27b-4bit',
    provider: 'llamacpp',
    name: 'Qwen3.5-27B-4bit',
    displayName: 'Qwen3.5 27B (4-bit) — Flash Streaming',
    supportsTools: true,
    isFree: true,
  },
  {
    id: 'llamacpp-custom',
    provider: 'llamacpp',
    name: 'custom',
    displayName: 'Custom Model (via llama-server)',
    supportsTools: true,
    isFree: true,
  },
]
export const LLAMACPP_DEFAULT_MODEL_ID = 'llamacpp-qwen35-35b-a3b-iq2m'

/** Mistral — OpenAI-compatible API at api.mistral.ai. */
export const MISTRAL_DEFAULT_BASE = 'https://api.mistral.ai/v1'

export const MISTRAL_MODELS: ModelConfig[] = [
  {
    id: 'mistral-large-latest',
    provider: 'mistral',
    name: 'mistral-large-latest',
    displayName: 'Mistral Large (latest)',
    supportsTools: true,
  },
  {
    id: 'mistral-small-latest',
    provider: 'mistral',
    name: 'mistral-small-latest',
    displayName: 'Mistral Small (latest)',
    supportsTools: true,
  },
  {
    id: 'codestral-latest',
    provider: 'mistral',
    name: 'codestral-latest',
    displayName: 'Codestral (latest)',
    supportsTools: true,
  },
]

/** GitHub Copilot — OpenAI-compatible chat; token from Pi auth or GH env vars. */
export const GITHUB_COPILOT_DEFAULT_BASE = 'https://api.githubcopilot.com'

export const GITHUB_COPILOT_MODELS: ModelConfig[] = [
  {
    id: 'copilot-gpt-4o',
    provider: 'githubCopilot',
    name: 'gpt-4o',
    displayName: 'Copilot GPT-4o',
    supportsTools: true,
  },
]

/**
 * Vertex AI OpenAI-compatible root (replace PROJECT_ID and region).
 * Docs: cloud.google.com/vertex-ai/generative-ai/docs/openai-compat
 */
export const GOOGLE_VERTEX_OPENAI_DEFAULT_BASE =
  'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/PROJECT_ID/locations/us-central1/endpoints/openapi'

export const GOOGLE_VERTEX_MODELS: ModelConfig[] = [
  {
    id: 'vertex-gemini-2-flash',
    provider: 'googleVertex',
    name: 'google/gemini-2.0-flash-001',
    displayName: 'Vertex Gemini 2.0 Flash',
    supportsTools: true,
  },
  {
    id: 'vertex-gemini-15-pro',
    provider: 'googleVertex',
    name: 'google/gemini-1.5-pro',
    displayName: 'Vertex Gemini 1.5 Pro',
    supportsTools: true,
  },
]

/** Bedrock model ids (Converse API). Region via provider baseUrl or env. */
/** Model picker id when using Hermes as a tools provider (name/base/key from Integrations → Hermes API). */
export const HERMES_PROVIDER_MODEL_ID = 'hermes-gateway' as const

export const BEDROCK_MODELS: ModelConfig[] = [
  {
    id: 'bedrock-claude-35-sonnet',
    provider: 'bedrock',
    name: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    displayName: 'Claude 3.5 Sonnet (Bedrock)',
    supportsTools: true,
  },
  {
    id: 'bedrock-claude-3-haiku',
    provider: 'bedrock',
    name: 'anthropic.claude-3-haiku-20240307-v1:0',
    displayName: 'Claude 3 Haiku (Bedrock)',
    supportsTools: true,
  },
]

export const PROVIDER_INFO: Record<Provider, { name: string; color: string; requiresKey: boolean; baseUrlOptional?: boolean }> = {
  openai: { name: 'OpenAI', color: '#10a37f', requiresKey: true },
  openaiCodex: { name: 'OpenAI Codex', color: '#22c55e', requiresKey: true, baseUrlOptional: true },
  anthropic: { name: 'Anthropic (Claude)', color: '#d97706', requiresKey: true, baseUrlOptional: true },
  ollama: { name: 'Ollama', color: '#ffffff', requiresKey: false, baseUrlOptional: true },
  openrouter: { name: 'OpenRouter', color: '#6366f1', requiresKey: true },
  google: { name: 'Google AI', color: '#4285f4', requiresKey: true },
  xai: { name: 'xAI (Grok)', color: '#0ea5e9', requiresKey: true, baseUrlOptional: true },
  zai: { name: 'Z.AI', color: '#8b5cf6', requiresKey: true, baseUrlOptional: true },
  llamacpp: { name: 'llama.cpp (Local)', color: '#f59e0b', requiresKey: false, baseUrlOptional: true },
  mistral: { name: 'Mistral AI', color: '#ff7000', requiresKey: true, baseUrlOptional: true },
  azureOpenai: { name: 'Azure OpenAI', color: '#0078d4', requiresKey: true, baseUrlOptional: true },
  githubCopilot: { name: 'GitHub Copilot', color: '#6e40c9', requiresKey: true, baseUrlOptional: true },
  googleVertex: { name: 'Google Vertex AI', color: '#34a853', requiresKey: true, baseUrlOptional: true },
  bedrock: { name: 'AWS Bedrock', color: '#ff9900', requiresKey: true, baseUrlOptional: true },
  hermes: {
    name: 'Hermes gateway',
    color: '#14b8a6',
    requiresKey: false,
    baseUrlOptional: true,
  },
}

/** Ollama and llama.cpp run locally without a UI API key. */
export function providerAllowsEmptyApiKey(provider: Provider): boolean {
  return !PROVIDER_INFO[provider].requiresKey
}

/**
 * Tauri `resolve_llm_api_key` / `llm_shell_credential_flags` use Pi-aligned ids (e.g. `azure-openai-responses`).
 */
export function tauriCredentialKeyForProvider(p: Provider): string {
  switch (p) {
    case 'openaiCodex':
      return 'openai-codex'
    case 'azureOpenai':
      return 'azure-openai-responses'
    case 'githubCopilot':
      return 'github-copilot'
    case 'googleVertex':
      return 'google-vertex'
    case 'bedrock':
      return 'bedrock'
    default:
      return p
  }
}

interface SettingsState {
  providers: Record<Provider, ProviderConfig>
  selectedModel: string | null
  showSettings: boolean
  /** Which section is shown when the modal is open (not persisted). */
  settingsSection: SettingsSectionId
  /**
   * One-shot: when true, AgentDataSection opens the Hermes accordion and scrolls it into view.
   * Cleared after consumption (not persisted).
   */
  settingsAgentExpandHermes: boolean
  /**
   * When true, user chose Hermes / another external agent as the planning loop — Orca is effector-only.
   * Greys model provider + default model UI in Settings → Models.
   */
  hermesOrchestratorMode: boolean
  /**
   * Internal lead routing. `'hermes'` flips the in-app orchestrator to the Hermes gateway
   * (sets selectedModel to HERMES_PROVIDER_MODEL_ID); `'default'` restores the previous model.
   * Distinct from `hermesOrchestratorMode` which hands off planning to an **external** Hermes bridge.
   */
  leadProfile: 'default' | 'hermes'
  /** Remembered selectedModel id before flipping leadProfile to 'hermes' (for one-click restore). */
  leadProfilePreviousModelId: string | null
  /**
   * When true (default), lock model UI if the bridge reports a recent `X-Orca-External-Agent: hermes` heartbeat.
   */
  hermesOrchestratorAutoDetect: boolean
  /** Base URL for Hermes API server (`/v1` suffix). See Hermes `API_SERVER_*` env. */
  hermesApiBaseUrl: string
  /** Optional `API_SERVER_KEY` — Bearer token for Hermes API server. */
  hermesApiKey: string
  /** Cosmetic model id sent to Hermes (actual model is configured in Hermes). */
  hermesModel: string
  /**
   * When true, `spawn_sub_agent` without explicit `runner` auto-routes to
   * `runner:"hermes"` if task/display/role text indicates Hermes intent.
   */
  hermesAutoRunnerForSubAgents: boolean
  /**
   * When true (default), "Hermes agent" appears in the new-tile menu, canvas context menu, and title bar.
   * When false, also removes `chat_with_hermes_tile` and `hermes_agent` from the orchestrator tool list so the
   * model uses standard `agent` tiles for multi-agent flows unless it explicitly uses `runner:"hermes"`.
   * Does not remove tiles already on the canvas.
   */
  showHermesAgentTile: boolean
  setShowHermesAgentTile: (v: boolean) => void
  /** Native Orca Telegram gateway: bot token (optional if server sets `ORCA_TELEGRAM_BOT_TOKEN`). */
  orcaTelegramBotToken: string
  /** Comma-separated Telegram user ids for native gateway allowlist. */
  orcaTelegramAllowedUserIds: string
  /** Set after any successful native gateway start (supports restart when token is only on the server). */
  orcaTelegramGatewayStartKnown: boolean
  setHermesApiBaseUrl: (v: string) => void
  setHermesApiKey: (v: string) => void
  setHermesModel: (v: string) => void
  setHermesAutoRunnerForSubAgents: (v: boolean) => void
  setOrcaTelegramBotToken: (v: string) => void
  setOrcaTelegramAllowedUserIds: (v: string) => void
  setOrcaTelegramGatewayStartKnown: (v: boolean) => void
  ollamaModels: ModelConfig[]
  /** From llama-server `GET /v1/models` when llama.cpp is enabled (ephemeral, not persisted). */
  llamacppModels: ModelConfig[]
  /** From OpenAI `GET /v1/models` when OpenAI auth is enabled (ephemeral, not persisted). */
  openaiModels: ModelConfig[]
  /** User-added OpenAI model ids for plans where `/v1/models` is incomplete. */
  openaiCustomModelIds: string[]
  /** User-added OpenRouter model slugs (`vendor/model` or `...:free`). */
  openrouterCustomModelIds: string[]
  /** Last successful `GET https://openrouter.ai/api/v1/models` (persisted for offline). */
  openrouterCatalog: OpenRouterCatalogEntry[]
  /** Unix ms when {@link openrouterCatalog} was last refreshed. */
  openrouterCatalogFetchedAt: number | null
  /** In-flight catalog fetch (not persisted). */
  openrouterCatalogBusy: boolean
  /** Last catalog fetch error message (not persisted). */
  openrouterCatalogError: string | null
  /**
   * Cached tool-use preflight results keyed by OpenRouter slug (`vendor/model[:tag]`).
   * Populated by {@link SettingsState.runOpenRouterPreflight}; displayed as
   * badges in the OpenRouter settings panel. Persisted so repeated Settings
   * openings don't re-hit the API.
   */
  openrouterPreflightResults: Record<string, import('../lib/openrouterPreflight').PreflightResult>
  /** Slugs with an in-flight preflight probe (not persisted). */
  openrouterPreflightBusy: Record<string, boolean>
  /** Set from Tauri: which providers have keys via env / ~/.hermes/.env / ~/.openclaw/.env */
  shellCredentialFlags: Partial<Record<Provider, boolean>>
  /** Raw JSON config for Hybrid provider/runtime policy orchestration (validated on set + hydrate). */
  hybridProviderConfigJson: string
  /** Last parse/validation errors for {@link hybridProviderConfigJson}. */
  hybridProviderConfigErrors: string[]
  /** Parsed config when valid; null for empty/invalid JSON. */
  hybridProviderConfig: HybridProviderConfig | null
  /** Effective runtime mode policies (localOrchestrator + hermesLead), persisted and validated. */
  hybridRuntimePolicies: HybridRuntimePolicies
  /** Auth lane profiles for hybrid packs; stores encrypted refs only (no plaintext tokens/cookies). */
  hybridAuthProfiles: AuthProfileRecord[]
  canvasTheme: CanvasThemeId
  ambientParticlesEnabled: boolean
  changelogAutomationEnabled: boolean
  /** Auto-open Research tile when the first web_search / doc query is recorded. */
  researchAutomationEnabled: boolean
  /**
   * When true, sub-agent merge-review tickets are approved automatically (git merge when a
   * worktree branch exists). Toggle lives on Agent tile ⋮ menu.
   */
  autoApproveMergeReviews: boolean
  setAutoApproveMergeReviews: (v: boolean) => void
  /** Rotating contextual tips in the left sidebar footer. */
  sidebarCanvasTipsEnabled: boolean
  setSidebarCanvasTipsEnabled: (v: boolean) => void
  /** Primary interaction shell for hybrid mode (persistent panel vs spotlight launcher). */
  hybridGuiShellMode: HybridGuiShellMode
  setHybridGuiShellMode: (mode: HybridGuiShellMode) => void
  /** Softer accent colors + reduced chrome contrast. */
  uiTheme: UiThemeId
  /** Shooting-star highlight on tile borders (idle tiles). */
  tileBorderAnimation: TileBorderAnimationId

  /** Preset bundle for motion/chrome (clean vs standard); custom when user overrides. */
  visualEffectsPreset: VisualEffectsPresetId
  /** Orchestrator hub → module SVG connection lines. */
  orchestratorHubLinksVisible: boolean
  orchestratorHubLinksMotionEnabled: boolean
  /** Multiplier on hub link opacities / vibrance (0–1.5). */
  hubLinksIntensityScale: number
  /** Speed multiplier for dash/spark durations (&gt;1 = faster). */
  hubLinksSpeedScale: number
  tileIdleGlowEnabled: boolean
  /** 0–1.5; scales idle tile drop-shadow glow. */
  tileIdleGlowStrength: number
  shootingStarSpeedScale: number
  /** Tile border shooting stars: optional extra respect for system reduced-motion (orthogonal to speed / single vs double). */
  shootingStarsHonorReducedMotion: boolean
  respectPrefersReducedMotion: boolean
  /** Global policy: if true, animate only the active/focused tile; if false, animate all visible tiles. */
  onlyAnimateFocusedTile: boolean
  orchestratorTileRevealEffectsEnabled: boolean
  editorAgentLineAnimationsEnabled: boolean
  /** Debounced disk save for workspace-backed editor files (Editor tile). */
  editorAutoSaveEnabled: boolean
  /** Monaco word wrap — mirrors the View menu check. */
  editorWordWrap: 'on' | 'off'
  /** Animated dashed-edge flow in the Obsidian Brain sidebar graph. */
  obsidianBrainGraphAnimationEnabled: boolean
  /** Typewriter-style reveal in the editor when the orchestrator writes a file (diff hunks). */
  agentWriteStreamEnabled: boolean
  /**
   * Strength of post-spawn tile repulsion / force settle (0–1.5).
   * 0 disables the extra settle pass and only runs the cheap overlap cascade.
   * 1 matches the `resolveOverlapsAround` baseline.
   */
  tileRepulsionStrength: number
  /** Graph view: include orchestrator delegation links. */
  graphLinksDelegationEnabled: boolean
  /** Graph view: include inferred data-flow links from tile metadata. */
  graphLinksDataFlowEnabled: boolean
  /** Graph view: include user-authored/manual links. */
  graphLinksManualEnabled: boolean
  /** Graph view: simulation force multiplier (0.2–2). */
  graphPhysicsStrength: number
  /** Graph view: visual node radius multiplier (0.6–1.8). */
  graphNodeScale: number
  /** When switching graph -> tiles, apply graph node positions to tile coordinates. */
  graphSyncOnExit: boolean
  /** Enable live magnetic repel+attract behavior while dragging in rich Tiles mode. */
  tileLiveMagneticDragEnabled: boolean
  /** When dragging orchestrator tile, softly move non-orchestrator tiles as a flock. */
  orchestratorGroupFollowEnabled: boolean
  /** Follower interpolation strength while dragging orchestrator (0.2–1). */
  orchestratorGroupFollowStrength: number
  /** Enable dynamic drag-time magnetic tuning while dragging nodes in Graph mode. */
  graphLiveMagneticDragEnabled: boolean
  /** Master switch for advanced graph workflow features (easy rollback). */
  graphAdvancedWorkflowEnabled: boolean
  /** Graph focus radius in world units for nearby-context and dimming. */
  graphContextRadius: number
  /**
   * How delegation relationships between an orchestrator hub, team leads and
   * worker sub-agents are drawn in the hub-links layer.
   *  - `'branch'`  — hub→lead, lead→worker (tree)
   *  - `'radial'`  — hub→every agent (flat; legacy)
   *  - `'both'`    — hub→worker at low alpha + lead→worker overlay
   */
  orchestratorDelegationLineMode: OrchestratorDelegationLineMode

  /** Tile-picker behavior (visibility + favorites) for toolbar/dropdowns. */
  tilePicker: Record<TileType, TilePickerPreference>
  /** Times each tile type was added from the Add tile menu (drives favorites order). */
  tilePickerAddCounts: Record<TileType, number>
  /** Workspace-relative output directory for rendered Remotion videos. */
  remotionOutputDir: string
  /**
   * Sub-agent (`spawn_sub_agent`) model overrides. `null` = use built-in routing (simple → OpenRouter free
   * when available; complex → main orchestrator model).
   */
  subAgentSimpleModelId: string | null
  subAgentComplexModelId: string | null
  /**
   * Z.AI GLM Coding Plan tier — sets concurrent API calls + sub-agent cap (Lite &lt; Pro &lt; Max).
   * Does not affect billing; matches your subscription for fewer 429s.
   */
  zaiPlanTier: ZaiPlanTier
  /**
   * Extra start-to-start pacing between orchestrator LLM rounds on Z.AI. The default
   * keeps the historical safe value found in prior stable commits.
   */
  zaiMinMsBetweenRounds: number
  /**
   * Global minimum gap between starts of queued Z.AI `chat/completions` requests.
   * Works with the concurrency semaphore to suppress bursty 429/1302 spikes.
   */
  zaiQueueMinGapMs: number
  /**
   * OpenRouter: on HTTP 429 for your chosen model, temporarily use {@link openrouterRateLimitFallbackModelId}
   * for {@link openrouterRateLimitFallbackMinutes} minutes (in-memory window; does not change the selected model).
   */
  openrouterRateLimitFallbackEnabled: boolean
  openrouterRateLimitFallbackModelId: string
  openrouterRateLimitFallbackMinutes: number

  /**
   * When true, the canvas allows unlimited tiles (no consolidation). Large projects can get visually heavy.
   * When false (default), non-agent modules merge into one tile per type with in-tile tabs; multiple agent tiles stay allowed.
   */
  picassoMode: boolean
  setPicassoMode: (v: boolean) => void

  /** 1-shot architecture phase: Cocoon-style SVG (default) vs Mermaid visual-explainer HTML. */
  oneShotArchitectureDiagramMode: OneShotArchitectureDiagramMode
  setOneShotArchitectureDiagramMode: (v: OneShotArchitectureDiagramMode) => void

  /** Domain-aware tile spawning (anchor + zones). Default on. */
  intelligentLayoutEnabled: boolean
  /** Anchor tile size as fraction of viewport (0.45–0.85). */
  intelligentLayoutAnchorRatio: number
  /** First spawn of strategy anchor type becomes large center tile. */
  intelligentLayoutAutoDetectAnchor: boolean
  setIntelligentLayoutEnabled: (v: boolean) => void
  setIntelligentLayoutAnchorRatio: (v: number) => void
  setIntelligentLayoutAutoDetectAnchor: (v: boolean) => void

  /**
   * When true (default), the **main** orchestrator only delegates via `spawn_sub_agent` + canvas
   * coordination — no direct file or execution tools. Sub-agent tiles keep the full tool set.
   */
  orchestratorLeadDelegationOnly: boolean
  /**
   * Optional LLM step before planning: expand shorthand / vague prompts into a clear goal.
   * `before_planning` runs only for heuristically **complex** turns (default). `always` runs every turn (+1 LLM call).
   */
  orchestratorArticulationMode: OrchestratorArticulationMode
  /** Append JSONL traces under `.agent-canvas/harness/traces/`. */
  harnessTraceRaw: boolean
  /**
   * When true with {@link harnessTraceRaw}, each JSONL file also gets `llm_round_meta`, `tool_call_detail`
   * (bounded redacted args/results), `compaction`, and `stagnation` rows — Meta-Harness–style diagnostics.
   */
  harnessTraceDetailed: boolean
  /** Persist lightweight harness snapshots under `.agent-canvas/harness/state.json` after runs. */
  harnessFileStateSnapshot: boolean
  harnessSafetyMode: 'off' | 'warn' | 'block'
  /** Ablation toggles (default true = current behavior). */
  harnessStagnationGuard: boolean
  harnessInspectErrorDetection: boolean
  harnessAutoFixGate: boolean
  harnessParallelBatchRules: boolean
  /** Shorter sub-agent user preamble (delegation optimization). */
  harnessSubAgentCompactContext: boolean
  /**
   * When true, orchestrator-injected terminal commands (`meta.command`) are checked with
   * `validateBashForMode` (read-only: block rm/cp/git commit/etc.). Manual typing is unaffected.
   */
  harnessTerminalReadOnlyBash: boolean
  /**
   * When true (desktop + git repo), each sub-agent spawn creates `git worktree` under
   * `.orca/worktrees/<id>` and adds context to the sub-agent prompt.
   */
  harnessSubAgentAutoWorktree: boolean

  /**
   * Persist ~/.orca sessions, tasks, terminals (Tauri) / localStorage fallback.
   * Canvas layout Safe Mode (incomplete rebuild) surfaces in `useWorkspaceRebuildStore` and
   * Settings → Agent & memory → Sessions & persistence.
   */
  orcaPersistenceEnabled: boolean
  /** Group similar auto-created tasks + rate limits (requires persistence). */
  orcaBurstAggregationEnabled: boolean
  /** Route high-severity inspect issues to bug-bounty lane instead of todos. */
  orcaBugBountyLaneEnabled: boolean
  /**
   * When true with {@link orcaBugBountyLaneEnabled}, new bounty items are auto-dispatched to the
   * bounty-hunter pool (up to {@link orcaBugBountyMaxHunters} concurrent troubleshooter sub-agents).
   */
  orcaBugBountyAutoDelegateSubagents: boolean
  /**
   * Maximum concurrent bounty-hunter sub-agents (troubleshooter troop) across the workspace.
   * When a hunter finishes, the pool picks the next queued bounty — otherwise the tile closes.
   */
  orcaBugBountyMaxHunters: number
  /**
   * Dedicated execution model for bounty-hunter (troubleshooter) sub-agents. `null` falls back
   * to normal sub-agent routing (complex override → primary). Letting hunters use a different
   * provider/key from the main orchestrator avoids slamming one endpoint with N concurrent
   * hunters + orchestrator calls (common source of 429s on Z.AI/GLM quota).
   */
  orcaBugBountyHunterModelId: string | null
  /** Auto-compact long sessions to summary.md when message count exceeds threshold. */
  orcaAutoCompactionEnabled: boolean
  /** Message count at which auto-compaction runs (when {@link orcaAutoCompactionEnabled}). Default 50. */
  orcaAutoCompactionThreshold: number
  /** Append distilled lessons + signals at session end (desktop). */
  orcaMemoryDistillerEnabled: boolean
  /** Read `.agent-canvas/harness/active-candidate.json` into the system prompt (opt-in). */
  harnessAutoApplyBestCandidate: boolean
  /**
   * When true (Tauri), allow writing `Orca/brain/**` markdown mirrors (errors, sessions, telemetry).
   * Sub-toggles below are ignored when this is false.
   */
  orcaVaultBrainMirrorEnabled: boolean
  /**
   * True after the user has toggled "Mirror orchestrator notes" at least once (persisted).
   * Used to migrate legacy default-off installs to default-on without overriding an explicit opt-out.
   */
  orcaVaultBrainMirrorUserChoice: boolean
  /** Mirror orchestrator failures to `Orca/brain/errors/*.md`. */
  orcaVaultMirrorErrors: boolean
  /** Mirror short post-run stubs to `Orca/brain/sessions/*.md`. */
  orcaVaultMirrorSessions: boolean
  /** Allow telemetry rollups under `Orca/brain/telemetry/`. */
  orcaVaultMirrorTelemetry: boolean
  /** Mirror full orchestrator transcript to `Orca/chat/<sessionId>.md` (Obsidian-readable). */
  orcaVaultMirrorChatTranscript: boolean
  /**
   * When true, system prompt may suggest updating `wiki/state.md` / `wiki/log.md` after meaningful work
   * (user still applies edits; no auto-write).
   */
  orcaVaultWikiDistillPrompt: boolean

  /**
   * When true (Tauri), dual-write `Orca/brain/**` and `Orca/chat/**` to the central Obsidian vault (iCloud).
   */
  centralBrainEnabled: boolean
  /** Absolute path to central vault; empty = default iCloud `OrcaBrain` / `~/OrcaBrain`. */
  centralBrainVaultPath: string
  /** When true, apply remote central vault changes back into the open workspace (debounced). */
  centralBrainReverseWatchEnabled: boolean

  /**
   * Display name for the orchestrator in chat (activity feed + transcript).
   * Defaults to "Assistant". Stored transcripts retain the canonical
   * "Assistant · " prefix — only the rendered label changes.
   */
  orchestratorDisplayName: string
  /** When true, merge `personality.md` (workspace → `~/.claude/` → `~/.orca/`) into the system prompt. */
  orchestratorPersonalityEnabled: boolean
  /** When true, merge `soul.md` (workspace → `~/.claude/` → `~/.orca/`) into the system prompt. */
  orchestratorSoulEnabled: boolean
  /** Canvas HUD narrator mode: deterministic templates vs model-generated. */
  narratorMode: NarratorMode
  /** Optional dedicated model id for AI narrator output (`null` = use selected default model). */
  narratorAiModelId: string | null

  /**
   * Short-term memory: max estimated characters for prior chat turns sent to the model (sliding window).
   * @see {@link trimMessagesForOrchestrator}
   */
  memoryShortTermMaxChars: number
  /** Long-term memory: inject `.orca/MEMORY.md` and/or `~/.orca/MEMORY.md` into the system prompt. */
  memoryLongTermEnabled: boolean
  memoryLongTermSource: OrcaMemoryLongTermSourceId
  /** Max characters of long-term memory content after load (before injection). */
  memoryLongTermMaxChars: number
  /** Inject `.orca/USER.md` and/or `~/.orca/USER.md` (Hermes-style user profile). */
  orcaUserProfileEnabled: boolean
  orcaUserProfileSource: OrcaUserProfileSourceId
  orcaUserProfileMaxChars: number
  /** End-of-session LLM distillation into USER.md (experimental; desktop). */
  orcaUserProfileDistillerEnabled: boolean
  /** Proactive heartbeat: periodic synthetic orchestrator runs when HEARTBEAT.md has content. */
  orchestratorHeartbeatEnabled: boolean
  /** Interval between heartbeat ticks (minutes). Min 1, max 1440. */
  orchestratorHeartbeatIntervalMinutes: number
  /** Prompt-layer autonomy policy (see `orchestratorAutonomyPolicy.ts`). */
  orchestratorAutonomyMode: OrchestratorAutonomyMode

  setOrchestratorDisplayName: (v: string) => void
  setOrchestratorPersonalityEnabled: (v: boolean) => void
  setOrchestratorSoulEnabled: (v: boolean) => void
  setNarratorMode: (v: NarratorMode) => void
  setNarratorAiModelId: (v: string | null) => void

  setMemoryShortTermMaxChars: (v: number) => void
  setMemoryLongTermEnabled: (v: boolean) => void
  setMemoryLongTermSource: (v: OrcaMemoryLongTermSourceId) => void
  setMemoryLongTermMaxChars: (v: number) => void
  setOrcaUserProfileEnabled: (v: boolean) => void
  setOrcaUserProfileSource: (v: OrcaUserProfileSourceId) => void
  setOrcaUserProfileMaxChars: (v: number) => void
  setOrcaUserProfileDistillerEnabled: (v: boolean) => void
  setOrchestratorHeartbeatEnabled: (v: boolean) => void
  setOrchestratorHeartbeatIntervalMinutes: (v: number) => void
  setOrchestratorAutonomyMode: (v: OrchestratorAutonomyMode) => void

  setOrcaPersistenceEnabled: (v: boolean) => void
  setOrcaBurstAggregationEnabled: (v: boolean) => void
  setOrcaBugBountyLaneEnabled: (v: boolean) => void
  setOrcaBugBountyAutoDelegateSubagents: (v: boolean) => void
  setOrcaBugBountyMaxHunters: (v: number) => void
  setOrcaBugBountyHunterModelId: (v: string | null) => void
  setOrcaAutoCompactionEnabled: (v: boolean) => void
  setOrcaAutoCompactionThreshold: (v: number) => void
  setOrcaMemoryDistillerEnabled: (v: boolean) => void
  setHarnessAutoApplyBestCandidate: (v: boolean) => void
  setOrcaVaultBrainMirrorEnabled: (v: boolean) => void
  setOrcaVaultMirrorErrors: (v: boolean) => void
  setOrcaVaultMirrorSessions: (v: boolean) => void
  setOrcaVaultMirrorTelemetry: (v: boolean) => void
  setOrcaVaultMirrorChatTranscript: (v: boolean) => void
  setOrcaVaultWikiDistillPrompt: (v: boolean) => void
  setCentralBrainEnabled: (v: boolean) => void
  setCentralBrainVaultPath: (v: string) => void
  setCentralBrainReverseWatchEnabled: (v: boolean) => void

  setOrchestratorLeadDelegationOnly: (v: boolean) => void
  setOrchestratorArticulationMode: (v: OrchestratorArticulationMode) => void
  setHarnessTraceRaw: (v: boolean) => void
  setHarnessTraceDetailed: (v: boolean) => void
  setHarnessFileStateSnapshot: (v: boolean) => void
  setHarnessSafetyMode: (v: 'off' | 'warn' | 'block') => void
  setHarnessStagnationGuard: (v: boolean) => void
  setHarnessInspectErrorDetection: (v: boolean) => void
  setHarnessAutoFixGate: (v: boolean) => void
  setHarnessParallelBatchRules: (v: boolean) => void
  setHarnessSubAgentCompactContext: (v: boolean) => void
  setHarnessTerminalReadOnlyBash: (v: boolean) => void
  setHarnessSubAgentAutoWorktree: (v: boolean) => void

  setProviderConfig: (provider: Provider, config: Partial<ProviderConfig>) => void
  setHybridProviderConfigJson: (json: string) => void
  setHybridRuntimePolicy: (mode: keyof HybridRuntimePolicies, patch: Partial<HybridRuntimeModePolicy>) => void
  setHybridAuthProfiles: (profiles: AuthProfileRecord[]) => void
  upsertHybridAuthProfile: (profile: AuthProfileRecord) => string[]
  clearHybridProviderConfigErrors: () => void
  setSelectedModel: (modelId: string) => void
  toggleSettings: () => void
  setSettingsSection: (section: SettingsSectionId) => void
  openSettingsToSection: (
    section: SettingsSectionId,
    opts?: { expandHermes?: boolean }
  ) => void
  setSettingsAgentExpandHermes: (v: boolean) => void
  setHermesOrchestratorMode: (v: boolean) => void
  setHermesOrchestratorAutoDetect: (v: boolean) => void
  /** Flip the in-app lead to Hermes (saves previous model id) or restore it. */
  setLeadProfile: (next: 'default' | 'hermes') => void
  refreshShellCredentials: () => Promise<void>
  getActiveProviders: () => Provider[]
  getAvailableModels: () => ModelConfig[]
  getProviderConfig: (provider: Provider) => ProviderConfig
  fetchOllamaModels: () => Promise<void>
  fetchLlamaCppModels: () => Promise<void>
  fetchOpenAiModels: () => Promise<void>
  addOpenAiCustomModel: (name: string) => void
  removeOpenAiCustomModel: (name: string) => void
  addOpenRouterCustomModel: (raw: string) => void
  removeOpenRouterCustomModel: (slug: string) => void
  refreshOpenRouterCatalog: () => Promise<void>
  /**
   * Probe an OpenRouter model's `/endpoints` to check whether any live provider
   * supports tool calls. Caches the result in {@link openrouterPreflightResults};
   * safe to call repeatedly (de-duped per slug). Never throws.
   *
   * Pass `{ force: true }` to bypass the 10-minute freshness window.
   */
  runOpenRouterPreflight: (
    slug: string,
    opts?: { force?: boolean }
  ) => Promise<import('../lib/openrouterPreflight').PreflightResult>
  setCanvasTheme: (theme: CanvasThemeId) => void
  setAmbientParticlesEnabled: (enabled: boolean) => void
  setChangelogAutomationEnabled: (enabled: boolean) => void
  setResearchAutomationEnabled: (enabled: boolean) => void
  setUiTheme: (theme: UiThemeId) => void
  setTileBorderAnimation: (mode: TileBorderAnimationId) => void
  setVisualEffectsPreset: (preset: 'default' | 'clean') => void
  setOrchestratorHubLinksVisible: (v: boolean) => void
  setOrchestratorHubLinksMotionEnabled: (v: boolean) => void
  setHubLinksIntensityScale: (v: number) => void
  setHubLinksSpeedScale: (v: number) => void
  setTileIdleGlowEnabled: (v: boolean) => void
  setTileIdleGlowStrength: (v: number) => void
  setShootingStarSpeedScale: (v: number) => void
  setShootingStarsHonorReducedMotion: (v: boolean) => void
  setRespectPrefersReducedMotion: (v: boolean) => void
  setOnlyAnimateFocusedTile: (v: boolean) => void
  setOrchestratorTileRevealEffectsEnabled: (v: boolean) => void
  setEditorAgentLineAnimationsEnabled: (v: boolean) => void
  setEditorAutoSaveEnabled: (v: boolean) => void
  setEditorWordWrap: (v: 'on' | 'off') => void
  setObsidianBrainGraphAnimationEnabled: (v: boolean) => void
  setAgentWriteStreamEnabled: (v: boolean) => void
  setTileRepulsionStrength: (v: number) => void
  setGraphLinksDelegationEnabled: (v: boolean) => void
  setGraphLinksDataFlowEnabled: (v: boolean) => void
  setGraphLinksManualEnabled: (v: boolean) => void
  setGraphPhysicsStrength: (v: number) => void
  setGraphNodeScale: (v: number) => void
  setGraphSyncOnExit: (v: boolean) => void
  setTileLiveMagneticDragEnabled: (v: boolean) => void
  setOrchestratorGroupFollowEnabled: (v: boolean) => void
  setOrchestratorGroupFollowStrength: (v: number) => void
  setGraphLiveMagneticDragEnabled: (v: boolean) => void
  setGraphAdvancedWorkflowEnabled: (v: boolean) => void
  setGraphContextRadius: (v: number) => void
  setOrchestratorDelegationLineMode: (v: OrchestratorDelegationLineMode) => void
  resetVisualEffectsToDefaults: () => void
  setTileVisibility: (type: TileType, visible: boolean) => void
  setTileFavorite: (type: TileType, favorite: boolean) => void
  recordTilePickerAdd: (type: TileType) => void
  setRemotionOutputDir: (dir: string) => void
  setSubAgentSimpleModelId: (id: string | null) => void
  setSubAgentComplexModelId: (id: string | null) => void
  setZaiPlanTier: (tier: ZaiPlanTier) => void
  setZaiMinMsBetweenRounds: (v: number) => void
  setZaiQueueMinGapMs: (v: number) => void
  setOpenrouterRateLimitFallbackEnabled: (v: boolean) => void
  setOpenrouterRateLimitFallbackModelId: (v: string) => void
  setOpenrouterRateLimitFallbackMinutes: (v: number) => void
}

function persistedZaiBaseUrl(raw: string | undefined): string {
  return migrateZaiBaseUrlToCoding((raw ?? '').trim())
}

function persistedOpenRouterBaseUrl(raw: string | undefined): string {
  const t = (raw ?? '').trim().replace(/\/$/, '')
  if (!t) return OPENROUTER_DEFAULT_BASE
  return t
}

function normalizeHarnessSafetyMode(
  raw: unknown,
  fallback: 'off' | 'warn' | 'block'
): 'off' | 'warn' | 'block' {
  if (raw === 'off' || raw === 'warn' || raw === 'block') return raw
  return fallback
}

function normalizeOpenAiAuthMode(raw: unknown): 'oauth' | 'apiKey' {
  return raw === 'apiKey' ? 'apiKey' : 'oauth'
}

function normalizeOneShotArchitectureDiagramMode(raw: unknown): OneShotArchitectureDiagramMode {
  if (raw === 'visual_explainer') return 'visual_explainer'
  return 'cocoon_ai'
}

/** Promote legacy default-off vault mirror to on unless the user explicitly toggled the master switch. Exported for tests. */
export function migrateSettingsPersistedStateForVaultMirror(
  persistedState: unknown,
  version: number
): unknown {
  const s = persistedState as Record<string, unknown> | null | undefined
  if (!s || version >= 1) return persistedState
  const explicit = s.orcaVaultBrainMirrorUserChoice === true
  const mirror = s.orcaVaultBrainMirrorEnabled
  if (!explicit && mirror === false) {
    return { ...s, orcaVaultBrainMirrorEnabled: true }
  }
  return persistedState
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: {
        openai: { enabled: false, authMode: 'oauth' },
        openaiCodex: { enabled: false, baseUrl: OPENAI_CODEX_DEFAULT_BASE },
        anthropic: { enabled: false },
        ollama: { enabled: false, baseUrl: 'http://localhost:11434' },
        openrouter: { enabled: false, baseUrl: OPENROUTER_DEFAULT_BASE },
        google: { enabled: false },
        xai: { enabled: false, baseUrl: XAI_DEFAULT_BASE },
        zai: { enabled: false, baseUrl: ZAI_DEFAULT_BASE },
        llamacpp: { enabled: false, baseUrl: LLAMACPP_DEFAULT_BASE },
        mistral: { enabled: false, baseUrl: MISTRAL_DEFAULT_BASE },
        azureOpenai: { enabled: false, useResponsesApi: false },
        githubCopilot: { enabled: false, baseUrl: GITHUB_COPILOT_DEFAULT_BASE },
        googleVertex: { enabled: false, baseUrl: GOOGLE_VERTEX_OPENAI_DEFAULT_BASE },
        bedrock: { enabled: false, baseUrl: 'us-east-1' },
        hermes: { enabled: false },
      },
      selectedModel: ZAI_DEFAULT_MODEL_ID,
      showSettings: false,
      settingsSection: 'models',
      settingsAgentExpandHermes: false,
      hermesOrchestratorMode: false,
      leadProfile: 'default' as const,
      leadProfilePreviousModelId: null,
      hermesOrchestratorAutoDetect: true,
      hermesApiBaseUrl: HERMES_API_DEFAULT_BASE,
      /** Empty = no UI key; Orca sends no Bearer to local Hermes and resolves Z.AI only for api.z.ai hosts. */
      hermesApiKey: '',
      hermesModel: HERMES_API_DEFAULT_MODEL,
      hermesAutoRunnerForSubAgents: false,
      showHermesAgentTile: true,
      orcaTelegramBotToken: '',
      orcaTelegramAllowedUserIds: '',
      orcaTelegramGatewayStartKnown: false,
      ollamaModels: [],
      llamacppModels: [],
      openaiModels: [],
      openaiCustomModelIds: [],
      openrouterCustomModelIds: [],
      openrouterCatalog: [],
      openrouterCatalogFetchedAt: null,
      openrouterCatalogBusy: false,
      openrouterCatalogError: null,
      openrouterPreflightResults: {},
      openrouterPreflightBusy: {},
      shellCredentialFlags: {},
      hybridProviderConfigJson: '',
      hybridProviderConfigErrors: [],
      hybridProviderConfig: null,
      hybridRuntimePolicies: cloneHybridRuntimePolicies(DEFAULT_HYBRID_RUNTIME_POLICIES),
      hybridAuthProfiles: [],
      canvasTheme: 'orca',
      ambientParticlesEnabled: false,
      changelogAutomationEnabled: true,
      researchAutomationEnabled: true,
      autoApproveMergeReviews: false,
      sidebarCanvasTipsEnabled: true,
      setSidebarCanvasTipsEnabled: (v) => set({ sidebarCanvasTipsEnabled: v }),
      hybridGuiShellMode: 'desktop_sidebar',
      setHybridGuiShellMode: (mode) => set({ hybridGuiShellMode: normalizeHybridGuiShellMode(mode) }),
      uiTheme: 'default',
      tileBorderAnimation: 'off',
      visualEffectsPreset: 'default',
      orchestratorHubLinksVisible: true,
      orchestratorHubLinksMotionEnabled: true,
      hubLinksIntensityScale: 1,
      hubLinksSpeedScale: 1,
      tileIdleGlowEnabled: true,
      tileIdleGlowStrength: 1,
      shootingStarSpeedScale: 1,
      shootingStarsHonorReducedMotion: false,
      respectPrefersReducedMotion: false,
      onlyAnimateFocusedTile: true,
      orchestratorTileRevealEffectsEnabled: true,
      editorAgentLineAnimationsEnabled: false,
      editorAutoSaveEnabled: true,
      editorWordWrap: 'on',
      obsidianBrainGraphAnimationEnabled: true,
      agentWriteStreamEnabled: true,
      tileRepulsionStrength: 1,
      graphLinksDelegationEnabled: true,
      graphLinksDataFlowEnabled: false,
      graphLinksManualEnabled: false,
      graphPhysicsStrength: 1,
      graphNodeScale: 1,
      graphSyncOnExit: false,
      tileLiveMagneticDragEnabled: true,
      orchestratorGroupFollowEnabled: true,
      orchestratorGroupFollowStrength: 0.56,
      graphLiveMagneticDragEnabled: true,
      graphAdvancedWorkflowEnabled: true,
      graphContextRadius: 420,
      orchestratorDelegationLineMode: 'branch',
      tilePicker: defaultTilePickerPreferences(),
      tilePickerAddCounts: defaultTilePickerAddCounts(),
      remotionOutputDir: 'videos/remotion',
      subAgentSimpleModelId: null,
      subAgentComplexModelId: null,
      zaiPlanTier: 'pro',
      zaiMinMsBetweenRounds: ZAI_HISTORICAL_SAFE_MIN_ROUND_MS,
      zaiQueueMinGapMs: ZAI_HISTORICAL_SAFE_QUEUE_GAP_MS,

      openrouterRateLimitFallbackEnabled: true,
      openrouterRateLimitFallbackModelId: 'qwen/qwen3-coder-30b-a3b-instruct',
      openrouterRateLimitFallbackMinutes: 2,

      picassoMode: false,
      setPicassoMode: (v) => set({ picassoMode: v }),

      oneShotArchitectureDiagramMode: 'cocoon_ai',
      setOneShotArchitectureDiagramMode: (v) => set({ oneShotArchitectureDiagramMode: v }),

      intelligentLayoutEnabled: true,
      intelligentLayoutAnchorRatio: 0.6,
      intelligentLayoutAutoDetectAnchor: true,

      setIntelligentLayoutEnabled: (v) => set({ intelligentLayoutEnabled: v }),
      setIntelligentLayoutAnchorRatio: (v) =>
        set({
          intelligentLayoutAnchorRatio: Math.min(0.85, Math.max(0.45, v)),
        }),
      setIntelligentLayoutAutoDetectAnchor: (v) => set({ intelligentLayoutAutoDetectAnchor: v }),

      /** When true, lead only coordinates via sub-agents (no direct execution tools). On by default; turn off to let the lead use file/terminal tools directly. */
      orchestratorLeadDelegationOnly: true,
      orchestratorArticulationMode: 'before_planning',
      harnessTraceRaw: true,
      harnessTraceDetailed: false,
      harnessFileStateSnapshot: true,
      harnessSafetyMode: 'warn',
      harnessStagnationGuard: true,
      harnessInspectErrorDetection: true,
      harnessAutoFixGate: true,
      harnessParallelBatchRules: true,
      harnessSubAgentCompactContext: false,
      harnessTerminalReadOnlyBash: false,
      harnessSubAgentAutoWorktree: false,

      orcaPersistenceEnabled: true,
      orcaBurstAggregationEnabled: false,
      orcaBugBountyLaneEnabled: true,
      orcaBugBountyAutoDelegateSubagents: true,
      orcaBugBountyMaxHunters: 3,
      orcaBugBountyHunterModelId: null,
      orcaAutoCompactionEnabled: true,
      orcaAutoCompactionThreshold: 50,
      /** Off by default until you verify benefit (see `docs/MEMORY_ARCHITECTURE.md` + `harness:eval --split memory`). */
      orcaMemoryDistillerEnabled: false,
      /** Reads `.agent-canvas/harness/active-candidate.json` when present — on by default with other harness features. */
      harnessAutoApplyBestCandidate: true,

      orcaVaultBrainMirrorEnabled: true,
      orcaVaultBrainMirrorUserChoice: false,
      orcaVaultMirrorErrors: true,
      orcaVaultMirrorSessions: true,
      orcaVaultMirrorTelemetry: false,
      orcaVaultMirrorChatTranscript: true,
      orcaVaultWikiDistillPrompt: false,

      centralBrainEnabled: true,
      centralBrainVaultPath: '',
      centralBrainReverseWatchEnabled: true,

      orchestratorDisplayName: 'Assistant',
      orchestratorPersonalityEnabled: true,
      orchestratorSoulEnabled: true,
      narratorMode: 'ai',
      narratorAiModelId: null,

      memoryShortTermMaxChars: 18_000,
      memoryLongTermEnabled: true,
      memoryLongTermSource: 'both',
      memoryLongTermMaxChars: 12_000,

      orcaUserProfileEnabled: true,
      orcaUserProfileSource: 'both',
      orcaUserProfileMaxChars: 2_400,
      orcaUserProfileDistillerEnabled: false,
      orchestratorHeartbeatEnabled: false,
      orchestratorHeartbeatIntervalMinutes: 30,
      orchestratorAutonomyMode: 'broad',

      setOrchestratorDisplayName: (v) =>
        set({
          orchestratorDisplayName: ((): string => {
            const raw = typeof v === 'string' ? v : ''
            const trimmed = raw.replace(/[·\r\n\t]/g, ' ').trim().slice(0, 48)
            return trimmed.length > 0 ? trimmed : 'Assistant'
          })(),
        }),
      setOrchestratorPersonalityEnabled: (v) => set({ orchestratorPersonalityEnabled: !!v }),
      setOrchestratorSoulEnabled: (v) => set({ orchestratorSoulEnabled: !!v }),
      setNarratorMode: (v) => set({ narratorMode: v === 'ai' ? 'ai' : 'template' }),
      setNarratorAiModelId: (v) =>
        set({ narratorAiModelId: typeof v === 'string' && v.trim() ? v.trim() : null }),

      setMemoryShortTermMaxChars: (v) =>
        set({
          memoryShortTermMaxChars: Math.min(200_000, Math.max(2_000, Math.floor(Number(v)) || 18_000)),
        }),
      setMemoryLongTermEnabled: (v) => set({ memoryLongTermEnabled: v }),
      setMemoryLongTermSource: (v) => set({ memoryLongTermSource: v }),
      setMemoryLongTermMaxChars: (v) =>
        set({
          memoryLongTermMaxChars: Math.min(50_000, Math.max(500, Math.floor(Number(v)) || 12_000)),
        }),

      setOrcaUserProfileEnabled: (v) => set({ orcaUserProfileEnabled: !!v }),
      setOrcaUserProfileSource: (v) =>
        set({
          orcaUserProfileSource:
            v === 'workspace' || v === 'user' || v === 'both' ? v : 'both',
        }),
      setOrcaUserProfileMaxChars: (v) =>
        set({
          orcaUserProfileMaxChars: Math.min(8_000, Math.max(400, Math.floor(Number(v)) || 2_400)),
        }),
      setOrcaUserProfileDistillerEnabled: (v) => set({ orcaUserProfileDistillerEnabled: !!v }),
      setOrchestratorHeartbeatEnabled: (v) => set({ orchestratorHeartbeatEnabled: !!v }),
      setOrchestratorHeartbeatIntervalMinutes: (v) =>
        set({
          orchestratorHeartbeatIntervalMinutes: Math.min(
            24 * 60,
            Math.max(1, Math.floor(Number(v)) || 30)
          ),
        }),
      setOrchestratorAutonomyMode: (v) =>
        set({ orchestratorAutonomyMode: normalizeOrchestratorAutonomyMode(v) }),

      setOrcaPersistenceEnabled: (v) => set({ orcaPersistenceEnabled: v }),
      setOrcaBurstAggregationEnabled: (v) => set({ orcaBurstAggregationEnabled: v }),
      setOrcaBugBountyLaneEnabled: (v) => set({ orcaBugBountyLaneEnabled: v }),
      setOrcaBugBountyAutoDelegateSubagents: (v) => set({ orcaBugBountyAutoDelegateSubagents: v }),
      setOrcaBugBountyMaxHunters: (v) =>
        set({ orcaBugBountyMaxHunters: Math.max(1, Math.min(8, Math.floor(Number(v)) || 3)) }),
      setOrcaBugBountyHunterModelId: (v) =>
        set({
          orcaBugBountyHunterModelId:
            typeof v === 'string' && v.trim().length > 0 ? v.trim() : null,
        }),
      setOrcaAutoCompactionEnabled: (v) => set({ orcaAutoCompactionEnabled: v }),
      setOrcaAutoCompactionThreshold: (v) =>
        set({
          orcaAutoCompactionThreshold: Math.min(500, Math.max(10, Math.floor(Number(v)) || 50)),
        }),
      setOrcaMemoryDistillerEnabled: (v) => set({ orcaMemoryDistillerEnabled: !!v }),
      setHarnessAutoApplyBestCandidate: (v) => set({ harnessAutoApplyBestCandidate: !!v }),
      setOrcaVaultBrainMirrorEnabled: (v) =>
        set({ orcaVaultBrainMirrorEnabled: v, orcaVaultBrainMirrorUserChoice: true }),
      setOrcaVaultMirrorErrors: (v) => set({ orcaVaultMirrorErrors: v }),
      setOrcaVaultMirrorSessions: (v) => set({ orcaVaultMirrorSessions: v }),
      setOrcaVaultMirrorTelemetry: (v) => set({ orcaVaultMirrorTelemetry: v }),
      setOrcaVaultMirrorChatTranscript: (v) => set({ orcaVaultMirrorChatTranscript: v }),
      setOrcaVaultWikiDistillPrompt: (v) => set({ orcaVaultWikiDistillPrompt: v }),
      setCentralBrainEnabled: (v) => set({ centralBrainEnabled: v }),
      setCentralBrainVaultPath: (v) => set({ centralBrainVaultPath: (v ?? '').trim() }),
      setCentralBrainReverseWatchEnabled: (v) => set({ centralBrainReverseWatchEnabled: v }),

  setOrchestratorLeadDelegationOnly: (v) => set({ orchestratorLeadDelegationOnly: v }),
  setOrchestratorArticulationMode: (v) =>
    set({ orchestratorArticulationMode: normalizeOrchestratorArticulationMode(v) }),
      setHarnessTraceRaw: (v) => set({ harnessTraceRaw: v }),
      setHarnessTraceDetailed: (v) => set({ harnessTraceDetailed: v }),
      setHarnessFileStateSnapshot: (v) => set({ harnessFileStateSnapshot: v }),
      setHarnessSafetyMode: (v) => set({ harnessSafetyMode: v }),
      setHarnessStagnationGuard: (v) => set({ harnessStagnationGuard: v }),
      setHarnessInspectErrorDetection: (v) => set({ harnessInspectErrorDetection: v }),
      setHarnessAutoFixGate: (v) => set({ harnessAutoFixGate: v }),
      setHarnessParallelBatchRules: (v) => set({ harnessParallelBatchRules: v }),
      setHarnessSubAgentCompactContext: (v) => set({ harnessSubAgentCompactContext: v }),
      setHarnessTerminalReadOnlyBash: (v) => set({ harnessTerminalReadOnlyBash: v }),
      setHarnessSubAgentAutoWorktree: (v) => set({ harnessSubAgentAutoWorktree: v }),

      setSubAgentSimpleModelId: (id) => set({ subAgentSimpleModelId: id }),
      setSubAgentComplexModelId: (id) => set({ subAgentComplexModelId: id }),
      setZaiPlanTier: (tier) => set({ zaiPlanTier: tier }),
      setZaiMinMsBetweenRounds: (v) => set({ zaiMinMsBetweenRounds: normalizeZaiMinMsBetweenRounds(v) }),
      setZaiQueueMinGapMs: (v) => set({ zaiQueueMinGapMs: normalizeZaiQueueMinGapMs(v) }),

      setOpenrouterRateLimitFallbackEnabled: (v) =>
        set({ openrouterRateLimitFallbackEnabled: !!v }),
      setOpenrouterRateLimitFallbackModelId: (v) =>
        set({
          openrouterRateLimitFallbackModelId:
            typeof v === 'string' && v.trim().length > 0
              ? v.trim()
              : 'qwen/qwen3-coder-30b-a3b-instruct',
        }),
      setOpenrouterRateLimitFallbackMinutes: (v) =>
        set({
          openrouterRateLimitFallbackMinutes: Math.min(60, Math.max(1, Math.floor(Number(v)) || 2)),
        }),

      refreshShellCredentials: async () => {
        if (
          typeof window === 'undefined' ||
          !('__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_IPC__' in window)
        ) {
          set({ shellCredentialFlags: {} })
          return
        }
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const raw = await invoke<Record<string, boolean>>('llm_shell_credential_flags')
          const shellCredentialFlags: Partial<Record<Provider, boolean>> = {}
          for (const p of Object.keys(PROVIDER_INFO) as Provider[]) {
            const tk = tauriCredentialKeyForProvider(p)
            if (raw[tk] !== undefined) shellCredentialFlags[p] = raw[tk]
          }
          set((state) => {
            const nextProviders = { ...state.providers }
            let selectedModel = state.selectedModel

            if (shellCredentialFlags.openaiCodex) {
              if (!nextProviders.openaiCodex.enabled) {
                nextProviders.openaiCodex = {
                  ...nextProviders.openaiCodex,
                  enabled: true,
                }
              }
              if (
                !selectedModel ||
                (selectedModel.startsWith('codex-') && !DEFAULT_MODELS.some((m) => m.id === selectedModel))
              ) {
                selectedModel = OPENAI_CODEX_DEFAULT_MODEL_ID
              }
            }

            return {
              shellCredentialFlags,
              providers: nextProviders,
              selectedModel,
            }
          })
        } catch {
          set({ shellCredentialFlags: {} })
        }
      },

      setProviderConfig: (provider, config) => {
        const normalized: Partial<ProviderConfig> = { ...config }
        if (provider === 'zai' && config.baseUrl !== undefined) {
          normalized.baseUrl = persistedZaiBaseUrl(config.baseUrl)
        }
        if (provider === 'openrouter' && config.baseUrl !== undefined) {
          normalized.baseUrl = persistedOpenRouterBaseUrl(config.baseUrl)
        }
        if (provider === 'openai' && config.authMode !== undefined) {
          normalized.authMode = normalizeOpenAiAuthMode(config.authMode)
          if (normalized.authMode === 'oauth') {
            normalized.useResponsesApi = false
          }
        }
        set((state) => {
          const nextProviders = {
            ...state.providers,
            [provider]: { ...state.providers[provider], ...normalized },
          }
          return {
            providers: nextProviders,
            selectedModel: resolveSelectedModelForProviderConfig(state.selectedModel, nextProviders),
          }
        })

        if (provider === 'ollama' && config.enabled) {
          get().fetchOllamaModels()
        }
        if (provider === 'llamacpp') {
          const { providers: next } = get()
          if (next.llamacpp.enabled) {
            get().fetchLlamaCppModels()
          }
        }
      },

      setHybridProviderConfigJson: (json) => {
        set((state) => {
          const resolved = resolveHybridProviderConfigState(json, state.hybridRuntimePolicies)
          return {
            hybridProviderConfigJson: resolved.hybridProviderConfigJson,
            hybridProviderConfigErrors: resolved.hybridProviderConfigErrors,
            hybridProviderConfig: resolved.hybridProviderConfig,
            hybridRuntimePolicies: resolved.hybridRuntimePolicies,
          }
        })
      },

      setHybridRuntimePolicy: (mode, patch) => {
        set((state) => {
          const fallback = state.hybridRuntimePolicies[mode]
          const nextModePolicy = normalizeHybridRuntimeModePolicy({ ...fallback, ...patch }, fallback)
          const nextPolicies: HybridRuntimePolicies = {
            ...state.hybridRuntimePolicies,
            [mode]: nextModePolicy,
          }
          return {
            hybridRuntimePolicies: nextPolicies,
          }
        })
      },

      setHybridAuthProfiles: (profiles) => {
        set({ hybridAuthProfiles: normalizeHybridAuthProfiles(profiles, []) })
      },

      upsertHybridAuthProfile: (profile) => {
        let errors: string[] = []
        set((state) => {
          const out = upsertAuthProfile(profile, state.hybridAuthProfiles)
          errors = out.errors
          if (out.errors.length > 0) return {}
          return { hybridAuthProfiles: out.next }
        })
        return errors
      },

      clearHybridProviderConfigErrors: () => set({ hybridProviderConfigErrors: [] }),

      setSelectedModel: (modelId) => {
        set((state) => ({
          selectedModel: resolveSelectedModelForProviderConfig(modelId, state.providers),
        }))
      },

      toggleSettings: () => {
        set((state) => ({ showSettings: !state.showSettings }))
      },

      setSettingsSection: (section) => set({ settingsSection: section }),

      setSettingsAgentExpandHermes: (v) => set({ settingsAgentExpandHermes: v }),

      openSettingsToSection: (section, opts) =>
        set({
          settingsSection: section,
          showSettings: true,
          ...(opts?.expandHermes ? { settingsAgentExpandHermes: true } : {}),
        }),

      setHermesOrchestratorMode: (v) => set({ hermesOrchestratorMode: v }),
      setHermesOrchestratorAutoDetect: (v) => set({ hermesOrchestratorAutoDetect: v }),
      setLeadProfile: (next) => {
        const state = get()
        if (next === 'hermes') {
          const prev = state.selectedModel
          if (state.leadProfile === 'hermes' && state.providers.hermes.enabled) return
          set({
            leadProfile: 'hermes',
            leadProfilePreviousModelId: prev !== HERMES_PROVIDER_MODEL_ID ? prev : state.leadProfilePreviousModelId,
            selectedModel: HERMES_PROVIDER_MODEL_ID,
            providers: {
              ...state.providers,
              hermes: { ...state.providers.hermes, enabled: true },
            },
          })
        } else {
          if (state.leadProfile === 'default') return
          const fallback = state.leadProfilePreviousModelId || ZAI_DEFAULT_MODEL_ID
          set({
            leadProfile: 'default',
            leadProfilePreviousModelId: null,
            selectedModel: fallback,
          })
        }
      },
      setHermesApiBaseUrl: (v) => set({ hermesApiBaseUrl: normalizeHermesApiBaseUrl(v) }),
      setHermesApiKey: (v) => set({ hermesApiKey: sanitizeHermesApiKeyForStorage(v) }),
      setHermesModel: (v) => set({ hermesModel: v.trim() || HERMES_API_DEFAULT_MODEL }),
      setHermesAutoRunnerForSubAgents: (v) => set({ hermesAutoRunnerForSubAgents: v }),
      setShowHermesAgentTile: (v) => set({ showHermesAgentTile: v }),
      setOrcaTelegramBotToken: (v) => set({ orcaTelegramBotToken: v }),
      setOrcaTelegramAllowedUserIds: (v) => set({ orcaTelegramAllowedUserIds: v }),
      setOrcaTelegramGatewayStartKnown: (v) => set({ orcaTelegramGatewayStartKnown: v }),

      getActiveProviders: () => {
        const { providers, shellCredentialFlags } = get()
        return (Object.keys(providers) as Provider[]).filter((p) => {
          if (!providers[p].enabled) return false
          if (!PROVIDER_INFO[p].requiresKey) return true
          const hasUi = !!(providers[p].apiKey && providers[p].apiKey.trim())
          const hasShell = !!shellCredentialFlags[p]
          return hasUi || hasShell
        })
      },

      getAvailableModels: () => {
        const { ollamaModels, openaiModels, openaiCustomModelIds, openrouterCustomModelIds } = get()
        const activeProviders = get()
          .getActiveProviders()
          .filter((provider) => !(provider === 'openai' && get().providers.openai.authMode === 'oauth'))
        
        let models = DEFAULT_MODELS.filter((m) => activeProviders.includes(m.provider))
        if (activeProviders.includes('openai') && openaiModels.length > 0) {
          const nonOpenAi = models.filter((m) => m.provider !== 'openai')
          const baseOpenAi = models.filter((m) => m.provider === 'openai')
          models = [...nonOpenAi, ...mergeProviderModels(baseOpenAi, openaiModels)]
        }
        if (activeProviders.includes('openai') && openaiCustomModelIds.length > 0) {
          const nonOpenAi = models.filter((m) => m.provider !== 'openai')
          const baseOpenAi = models.filter((m) => m.provider === 'openai')
          const customOpenAi = openaiCustomModelIds.map((name) => openAiCustomModelConfig(name))
          models = [...nonOpenAi, ...mergeProviderModels(baseOpenAi, customOpenAi)]
        }
        
        if (activeProviders.includes('openrouter')) {
          const customOr = openrouterCustomModelIds.map(openRouterCustomModelConfig)
          models = [...models, ...mergeProviderModels(OPENROUTER_MODELS, customOr)]
        }

        if (activeProviders.includes('zai')) {
          models = [...models, ...ZAI_MODELS]
        }

        if (activeProviders.includes('xai')) {
          models = [...models, ...XAI_MODELS]
        }
        
        if (activeProviders.includes('ollama')) {
          models = [...models, ...ollamaModels]
        }

        if (activeProviders.includes('llamacpp')) {
          const { llamacppModels } = get()
          const discovered = llamacppModels.length > 0 ? llamacppModels : []
          const merged =
            discovered.length > 0
              ? [
                  ...discovered,
                  ...LLAMACPP_MODELS.filter(
                    (m) => !discovered.some((d) => d.name === m.name)
                  ),
                ]
              : [...LLAMACPP_MODELS]
          models = [...models, ...merged]
        }

        if (activeProviders.includes('mistral')) {
          models = [...models, ...MISTRAL_MODELS]
        }
        if (activeProviders.includes('githubCopilot')) {
          models = [...models, ...GITHUB_COPILOT_MODELS]
        }
        if (activeProviders.includes('googleVertex')) {
          models = [...models, ...GOOGLE_VERTEX_MODELS]
        }
        if (activeProviders.includes('bedrock')) {
          models = [...models, ...BEDROCK_MODELS]
        }

        if (activeProviders.includes('hermes')) {
          const hm = get().hermesModel.trim() || HERMES_API_DEFAULT_MODEL
          models = [
            ...models,
            {
              id: HERMES_PROVIDER_MODEL_ID,
              provider: 'hermes',
              name: hm,
              displayName: `Hermes (${hm})`,
              supportsTools: true,
            },
          ]
        }

        return models
      },

      getProviderConfig: (provider) => {
        return get().providers[provider]
      },

      fetchOllamaModels: async () => {
        const { providers } = get()
        const { resolveBaseUrl } = await import('../lib/llmCredentials')
        const resolved = await resolveBaseUrl('ollama', providers.ollama.baseUrl)
        const baseUrl = resolved || providers.ollama.baseUrl || 'http://localhost:11434'
        
        try {
          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)
          if (!response.ok) throw new Error('Failed to fetch')
          
          const data = await response.json()
          const models: ModelConfig[] = (data.models || []).map((m: { name: string }) => ({
            id: `ollama-${m.name}`,
            provider: 'ollama' as Provider,
            name: m.name,
            displayName: m.name,
          }))
          
          set({ ollamaModels: models })
        } catch {
          // Ollama often offline in dev — avoid noisy console errors
          set({ ollamaModels: [] })
        }
      },

      fetchLlamaCppModels: async () => {
        const { providers } = get()
        const { resolveBaseUrl } = await import('../lib/llmCredentials')
        const resolved = await resolveBaseUrl('llamacpp', providers.llamacpp.baseUrl)
        const baseUrl = (
          resolved ||
          providers.llamacpp.baseUrl ||
          LLAMACPP_DEFAULT_BASE
        ).replace(/\/$/, '')

        try {
          const response = await fetch(`${baseUrl}/v1/models`)
          if (!response.ok) throw new Error('Failed to fetch')
          const data = (await response.json()) as { data?: Array<{ id?: string }> }
          const raw = Array.isArray(data.data) ? data.data : []
          const models: ModelConfig[] = []
          for (const entry of raw) {
            const id = typeof entry?.id === 'string' ? entry.id : ''
            if (!id) continue
            const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_')
            models.push({
              id: `llamacpp-${safeId}`,
              provider: 'llamacpp',
              name: id,
              displayName: id,
              supportsTools: true,
              isFree: true,
            })
          }
          set({ llamacppModels: models })
        } catch {
          set({ llamacppModels: [] })
        }
      },

      fetchOpenAiModels: async () => {
        const { providers } = get()
        try {
          const [{ resolveApiKey, resolveBaseUrl }, { agentFetch }] = await Promise.all([
            import('../lib/llmCredentials'),
            import('../lib/agentFetch'),
          ])
          const [apiKey, resolvedBase] = await Promise.all([
            resolveApiKey('openai', providers.openai.apiKey),
            resolveBaseUrl('openai', providers.openai.baseUrl),
          ])
          if (!apiKey?.trim()) {
            set({ openaiModels: [] })
            return
          }
          const baseUrl = (resolvedBase || providers.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
          const response = await agentFetch(`${baseUrl}/models`, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          })
          if (!response.ok) throw new Error(`OpenAI models failed: ${response.status}`)
          const data = (await response.json()) as OpenAiModelsResponse
          set({ openaiModels: normalizeOpenAiDiscoveredModels(data) })
        } catch {
          set({ openaiModels: [] })
        }
      },

      addOpenAiCustomModel: (name) => {
        const next = name.trim()
        if (!next) return
        set((state) => ({
          openaiCustomModelIds: normalizeCustomModelIds([...state.openaiCustomModelIds, next]),
        }))
      },

      removeOpenAiCustomModel: (name) => {
        const target = name.trim()
        if (!target) return
        set((state) => ({
          openaiCustomModelIds: state.openaiCustomModelIds.filter((m) => m !== target),
        }))
      },

      addOpenRouterCustomModel: (raw) => {
        const parts = raw
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
        if (parts.length === 0) return
        set((state) => ({
          openrouterCustomModelIds: normalizeCustomModelIds([
            ...state.openrouterCustomModelIds,
            ...parts,
          ]),
        }))
      },

      removeOpenRouterCustomModel: (slug) => {
        const target = slug.trim()
        if (!target) return
        set((state) => ({
          openrouterCustomModelIds: state.openrouterCustomModelIds.filter((m) => m !== target),
        }))
      },

      refreshOpenRouterCatalog: async () => {
        set({ openrouterCatalogBusy: true, openrouterCatalogError: null })
        try {
          const [{ resolveApiKey }, { agentFetch }] = await Promise.all([
            import('../lib/llmCredentials'),
            import('../lib/agentFetch'),
          ])
          const { providers } = get()
          const apiKey = await resolveApiKey('openrouter', providers.openrouter.apiKey)
          const headers: HeadersInit = {}
          if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
          const response = await agentFetch('https://openrouter.ai/api/v1/models', { headers })
          if (!response.ok) throw new Error(`OpenRouter models failed: ${response.status}`)
          const data = await response.json()
          const catalog = normalizeOpenRouterCatalogResponse(data)
          set({
            openrouterCatalog: catalog,
            openrouterCatalogFetchedAt: Date.now(),
            openrouterCatalogBusy: false,
            openrouterCatalogError: null,
          })
        } catch (e) {
          set({
            openrouterCatalogBusy: false,
            openrouterCatalogError: e instanceof Error ? e.message : String(e),
          })
        }
      },

      runOpenRouterPreflight: async (slug, opts) => {
        const target = (slug || '').trim()
        if (!target) {
          return {
            status: 'skipped',
            detail: 'No model slug provided.',
            checkedAt: Date.now(),
          }
        }
        const PREFLIGHT_TTL_MS = 10 * 60 * 1000
        const state = get()
        const cached = state.openrouterPreflightResults[target]
        if (
          !opts?.force &&
          cached &&
          Date.now() - cached.checkedAt < PREFLIGHT_TTL_MS &&
          cached.status !== 'network' &&
          cached.status !== 'rate-limited'
        ) {
          return cached
        }
        if (state.openrouterPreflightBusy[target]) {
          // Return the stale cached value (or a neutral skipped placeholder)
          // while a concurrent probe is in-flight; the in-flight one will
          // update the store when it resolves.
          return (
            cached ?? { status: 'skipped', detail: 'Preflight already in progress.', checkedAt: Date.now() }
          )
        }
        set((s) => ({
          openrouterPreflightBusy: { ...s.openrouterPreflightBusy, [target]: true },
        }))
        try {
          const [{ resolveApiKey }, { preflightOpenRouterModel }] = await Promise.all([
            import('../lib/llmCredentials'),
            import('../lib/openrouterPreflight'),
          ])
          const apiKey = await resolveApiKey('openrouter', get().providers.openrouter.apiKey)
          const result = await preflightOpenRouterModel(target, apiKey)
          set((s) => {
            const nextBusy = { ...s.openrouterPreflightBusy }
            delete nextBusy[target]
            return {
              openrouterPreflightResults: { ...s.openrouterPreflightResults, [target]: result },
              openrouterPreflightBusy: nextBusy,
            }
          })
          return result
        } catch (err) {
          const fallback = {
            status: 'unknown' as const,
            detail: err instanceof Error ? err.message : 'Preflight failed unexpectedly.',
            checkedAt: Date.now(),
          }
          set((s) => {
            const nextBusy = { ...s.openrouterPreflightBusy }
            delete nextBusy[target]
            return {
              openrouterPreflightResults: { ...s.openrouterPreflightResults, [target]: fallback },
              openrouterPreflightBusy: nextBusy,
            }
          })
          return fallback
        }
      },

      setCanvasTheme: (theme) => set({ canvasTheme: normalizeCanvasThemeId(theme) }),

      setAmbientParticlesEnabled: (enabled) =>
        set({ ambientParticlesEnabled: enabled, visualEffectsPreset: 'custom' }),

      setChangelogAutomationEnabled: (enabled) => set({ changelogAutomationEnabled: enabled }),
      setResearchAutomationEnabled: (enabled) => set({ researchAutomationEnabled: enabled }),
      setAutoApproveMergeReviews: (enabled) => set({ autoApproveMergeReviews: enabled }),

      setUiTheme: (theme) => set({ uiTheme: normalizeUiThemeId(theme) }),

      setTileBorderAnimation: (mode) =>
        set({ tileBorderAnimation: normalizeTileBorderAnimationId(mode), visualEffectsPreset: 'custom' }),

      setVisualEffectsPreset: (preset) => {
        if (preset === 'clean') {
          set({
            visualEffectsPreset: 'clean',
            ambientParticlesEnabled: false,
            tileBorderAnimation: 'off',
            tileIdleGlowEnabled: false,
            tileIdleGlowStrength: 1,
            orchestratorHubLinksVisible: false,
            orchestratorHubLinksMotionEnabled: false,
            hubLinksIntensityScale: 1,
            hubLinksSpeedScale: 1,
            shootingStarSpeedScale: 1,
            shootingStarsHonorReducedMotion: false,
            onlyAnimateFocusedTile: true,
            orchestratorTileRevealEffectsEnabled: false,
            editorAgentLineAnimationsEnabled: false,
            obsidianBrainGraphAnimationEnabled: false,
          })
        } else {
          set({
            visualEffectsPreset: 'default',
            ambientParticlesEnabled: false,
            tileBorderAnimation: 'off',
            orchestratorHubLinksVisible: true,
            orchestratorHubLinksMotionEnabled: true,
            hubLinksIntensityScale: 1,
            hubLinksSpeedScale: 1,
            tileIdleGlowEnabled: true,
            tileIdleGlowStrength: 1,
            shootingStarSpeedScale: 1,
            shootingStarsHonorReducedMotion: false,
            respectPrefersReducedMotion: false,
            onlyAnimateFocusedTile: true,
            orchestratorTileRevealEffectsEnabled: true,
            editorAgentLineAnimationsEnabled: false,
            obsidianBrainGraphAnimationEnabled: true,
          })
        }
      },

      resetVisualEffectsToDefaults: () => {
        get().setVisualEffectsPreset('default')
      },

      setOrchestratorHubLinksVisible: (v) =>
        set({ orchestratorHubLinksVisible: v, visualEffectsPreset: 'custom' }),
      setOrchestratorHubLinksMotionEnabled: (v) =>
        set({ orchestratorHubLinksMotionEnabled: v, visualEffectsPreset: 'custom' }),
      setHubLinksIntensityScale: (v) =>
        set({
          hubLinksIntensityScale: normalizeHubScale(v, 1, 0, 1.5),
          visualEffectsPreset: 'custom',
        }),
      setHubLinksSpeedScale: (v) =>
        set({
          hubLinksSpeedScale: normalizeHubScale(v, 1, 0.45, 2),
          visualEffectsPreset: 'custom',
        }),
      setTileIdleGlowEnabled: (v) => set({ tileIdleGlowEnabled: v, visualEffectsPreset: 'custom' }),
      setTileIdleGlowStrength: (v) =>
        set({
          tileIdleGlowStrength: normalizeHubScale(v, 1, 0, 1.5),
          visualEffectsPreset: 'custom',
        }),
      setShootingStarSpeedScale: (v) =>
        set({
          shootingStarSpeedScale: normalizeHubScale(v, 1, 0.45, 2),
          visualEffectsPreset: 'custom',
        }),
      setShootingStarsHonorReducedMotion: (v) =>
        set({ shootingStarsHonorReducedMotion: v, visualEffectsPreset: 'custom' }),
      setRespectPrefersReducedMotion: (v) =>
        set({ respectPrefersReducedMotion: v, visualEffectsPreset: 'custom' }),
      setOnlyAnimateFocusedTile: (v) =>
        set({ onlyAnimateFocusedTile: v, visualEffectsPreset: 'custom' }),
      setOrchestratorTileRevealEffectsEnabled: (v) =>
        set({ orchestratorTileRevealEffectsEnabled: v, visualEffectsPreset: 'custom' }),
        setEditorAgentLineAnimationsEnabled: (v) =>
        set({ editorAgentLineAnimationsEnabled: v, visualEffectsPreset: 'custom' }),
        setEditorAutoSaveEnabled: (v) => set({ editorAutoSaveEnabled: v }),
        setEditorWordWrap: (v) => set({ editorWordWrap: v }),
      setObsidianBrainGraphAnimationEnabled: (v) =>
        set({ obsidianBrainGraphAnimationEnabled: v, visualEffectsPreset: 'custom' }),
      setAgentWriteStreamEnabled: (v) =>
        set({ agentWriteStreamEnabled: v, visualEffectsPreset: 'custom' }),
      setTileRepulsionStrength: (v) =>
        set({ tileRepulsionStrength: normalizeHubScale(v, 1, 0, 1.5) }),
      setGraphLinksDelegationEnabled: (v) => set({ graphLinksDelegationEnabled: v }),
      setGraphLinksDataFlowEnabled: (v) => set({ graphLinksDataFlowEnabled: v }),
      setGraphLinksManualEnabled: (v) => set({ graphLinksManualEnabled: v }),
      setGraphPhysicsStrength: (v) =>
        set({ graphPhysicsStrength: normalizeHubScale(v, 1, 0.2, 2) }),
      setGraphNodeScale: (v) =>
        set({ graphNodeScale: normalizeHubScale(v, 1, 0.6, 1.8) }),
      setGraphSyncOnExit: (v) => set({ graphSyncOnExit: v }),
      setTileLiveMagneticDragEnabled: (v) => set({ tileLiveMagneticDragEnabled: v }),
      setOrchestratorGroupFollowEnabled: (v) =>
        set({ orchestratorGroupFollowEnabled: v }),
      setOrchestratorGroupFollowStrength: (v) =>
        set({ orchestratorGroupFollowStrength: normalizeHubScale(v, 0.56, 0.2, 1) }),
      setGraphLiveMagneticDragEnabled: (v) => set({ graphLiveMagneticDragEnabled: v }),
      setGraphAdvancedWorkflowEnabled: (v) => set({ graphAdvancedWorkflowEnabled: v }),
      setGraphContextRadius: (v) =>
        set({ graphContextRadius: Math.max(120, Math.min(1600, Math.round(v))) }),
      setOrchestratorDelegationLineMode: (v) =>
        set({ orchestratorDelegationLineMode: normalizeOrchestratorDelegationLineMode(v) }),

      setTileVisibility: (type, visible) =>
        set((state) => ({
          tilePicker: {
            ...state.tilePicker,
            [type]: {
              ...(state.tilePicker[type] ?? { visible: true, favorite: false }),
              visible,
            },
          },
        })),

      setTileFavorite: (type, favorite) =>
        set((state) => ({
          tilePicker: {
            ...state.tilePicker,
            [type]: {
              ...(state.tilePicker[type] ?? { visible: true, favorite: false }),
              favorite,
            },
          },
        })),

      recordTilePickerAdd: (type) =>
        set((state) => ({
          tilePickerAddCounts: {
            ...state.tilePickerAddCounts,
            [type]: (state.tilePickerAddCounts[type] ?? 0) + 1,
          },
        })),

      setRemotionOutputDir: (dir) => {
        const normalized = dir.replace(/^\/+/, '').trim() || 'videos/remotion'
        set({ remotionOutputDir: normalized })
      },
    }),
    {
      name: 'agent-canvas-settings',
      version: 1,
      migrate: migrateSettingsPersistedStateForVaultMirror,
      partialize: (state) => ({
        providers: state.providers,
        selectedModel: state.selectedModel,
        hermesOrchestratorMode: state.hermesOrchestratorMode,
        hermesOrchestratorAutoDetect: state.hermesOrchestratorAutoDetect,
        leadProfile: state.leadProfile,
        leadProfilePreviousModelId: state.leadProfilePreviousModelId,
        hermesApiBaseUrl: state.hermesApiBaseUrl,
        hermesApiKey: state.hermesApiKey,
        hermesModel: state.hermesModel,
        hermesAutoRunnerForSubAgents: state.hermesAutoRunnerForSubAgents,
        showHermesAgentTile: state.showHermesAgentTile,
        orcaTelegramBotToken: state.orcaTelegramBotToken,
        orcaTelegramAllowedUserIds: state.orcaTelegramAllowedUserIds,
        orcaTelegramGatewayStartKnown: state.orcaTelegramGatewayStartKnown,
        canvasTheme: state.canvasTheme,
        ambientParticlesEnabled: state.ambientParticlesEnabled,
        changelogAutomationEnabled: state.changelogAutomationEnabled,
        researchAutomationEnabled: state.researchAutomationEnabled,
        autoApproveMergeReviews: state.autoApproveMergeReviews,
        sidebarCanvasTipsEnabled: state.sidebarCanvasTipsEnabled,
        hybridGuiShellMode: state.hybridGuiShellMode,
        uiTheme: state.uiTheme,
        tileBorderAnimation: state.tileBorderAnimation,
        visualEffectsPreset: state.visualEffectsPreset,
        orchestratorHubLinksVisible: state.orchestratorHubLinksVisible,
        orchestratorHubLinksMotionEnabled: state.orchestratorHubLinksMotionEnabled,
        hubLinksIntensityScale: state.hubLinksIntensityScale,
        hubLinksSpeedScale: state.hubLinksSpeedScale,
        tileIdleGlowEnabled: state.tileIdleGlowEnabled,
        tileIdleGlowStrength: state.tileIdleGlowStrength,
        shootingStarSpeedScale: state.shootingStarSpeedScale,
        shootingStarsHonorReducedMotion: state.shootingStarsHonorReducedMotion,
        respectPrefersReducedMotion: state.respectPrefersReducedMotion,
        onlyAnimateFocusedTile: state.onlyAnimateFocusedTile,
        orchestratorTileRevealEffectsEnabled: state.orchestratorTileRevealEffectsEnabled,
        editorAgentLineAnimationsEnabled: state.editorAgentLineAnimationsEnabled,
        editorAutoSaveEnabled: state.editorAutoSaveEnabled,
        editorWordWrap: state.editorWordWrap,
        obsidianBrainGraphAnimationEnabled: state.obsidianBrainGraphAnimationEnabled,
        agentWriteStreamEnabled: state.agentWriteStreamEnabled,
        tileRepulsionStrength: state.tileRepulsionStrength,
        graphLinksDelegationEnabled: state.graphLinksDelegationEnabled,
        graphLinksDataFlowEnabled: state.graphLinksDataFlowEnabled,
        graphLinksManualEnabled: state.graphLinksManualEnabled,
        graphPhysicsStrength: state.graphPhysicsStrength,
        graphNodeScale: state.graphNodeScale,
        graphSyncOnExit: state.graphSyncOnExit,
        tileLiveMagneticDragEnabled: state.tileLiveMagneticDragEnabled,
        orchestratorGroupFollowEnabled: state.orchestratorGroupFollowEnabled,
        orchestratorGroupFollowStrength: state.orchestratorGroupFollowStrength,
        graphLiveMagneticDragEnabled: state.graphLiveMagneticDragEnabled,
        graphAdvancedWorkflowEnabled: state.graphAdvancedWorkflowEnabled,
        graphContextRadius: state.graphContextRadius,
        orchestratorDelegationLineMode: state.orchestratorDelegationLineMode,
        tilePicker: state.tilePicker,
        tilePickerAddCounts: state.tilePickerAddCounts,
        remotionOutputDir: state.remotionOutputDir,
        subAgentSimpleModelId: state.subAgentSimpleModelId,
        subAgentComplexModelId: state.subAgentComplexModelId,
        zaiPlanTier: state.zaiPlanTier,
        zaiMinMsBetweenRounds: state.zaiMinMsBetweenRounds,
        zaiQueueMinGapMs: state.zaiQueueMinGapMs,
        openrouterRateLimitFallbackEnabled: state.openrouterRateLimitFallbackEnabled,
        openrouterRateLimitFallbackModelId: state.openrouterRateLimitFallbackModelId,
        openrouterRateLimitFallbackMinutes: state.openrouterRateLimitFallbackMinutes,
        openaiCustomModelIds: state.openaiCustomModelIds,
        openrouterCustomModelIds: state.openrouterCustomModelIds,
        openrouterCatalog: state.openrouterCatalog,
        openrouterCatalogFetchedAt: state.openrouterCatalogFetchedAt,
        openrouterPreflightResults: state.openrouterPreflightResults,
        hybridProviderConfigJson: state.hybridProviderConfigJson,
        hybridRuntimePolicies: state.hybridRuntimePolicies,
        hybridAuthProfiles: state.hybridAuthProfiles,
        orchestratorLeadDelegationOnly: state.orchestratorLeadDelegationOnly,
        orchestratorArticulationMode: state.orchestratorArticulationMode,
        harnessTraceRaw: state.harnessTraceRaw,
        harnessTraceDetailed: state.harnessTraceDetailed,
        harnessFileStateSnapshot: state.harnessFileStateSnapshot,
        harnessSafetyMode: state.harnessSafetyMode,
        harnessStagnationGuard: state.harnessStagnationGuard,
        harnessInspectErrorDetection: state.harnessInspectErrorDetection,
        harnessAutoFixGate: state.harnessAutoFixGate,
        harnessParallelBatchRules: state.harnessParallelBatchRules,
        harnessSubAgentCompactContext: state.harnessSubAgentCompactContext,
        harnessTerminalReadOnlyBash: state.harnessTerminalReadOnlyBash,
        harnessSubAgentAutoWorktree: state.harnessSubAgentAutoWorktree,
        orcaPersistenceEnabled: state.orcaPersistenceEnabled,
        orcaBurstAggregationEnabled: state.orcaBurstAggregationEnabled,
        orcaBugBountyLaneEnabled: state.orcaBugBountyLaneEnabled,
        orcaBugBountyAutoDelegateSubagents: state.orcaBugBountyAutoDelegateSubagents,
        orcaBugBountyMaxHunters: state.orcaBugBountyMaxHunters,
        orcaBugBountyHunterModelId: state.orcaBugBountyHunterModelId,
        orcaAutoCompactionEnabled: state.orcaAutoCompactionEnabled,
        orcaAutoCompactionThreshold: state.orcaAutoCompactionThreshold,
        orcaMemoryDistillerEnabled: state.orcaMemoryDistillerEnabled,
        harnessAutoApplyBestCandidate: state.harnessAutoApplyBestCandidate,
        orcaVaultBrainMirrorEnabled: state.orcaVaultBrainMirrorEnabled,
        orcaVaultBrainMirrorUserChoice: state.orcaVaultBrainMirrorUserChoice,
        orcaVaultMirrorErrors: state.orcaVaultMirrorErrors,
        orcaVaultMirrorSessions: state.orcaVaultMirrorSessions,
        orcaVaultMirrorTelemetry: state.orcaVaultMirrorTelemetry,
        orcaVaultMirrorChatTranscript: state.orcaVaultMirrorChatTranscript,
        orcaVaultWikiDistillPrompt: state.orcaVaultWikiDistillPrompt,
        centralBrainEnabled: state.centralBrainEnabled,
        centralBrainVaultPath: state.centralBrainVaultPath,
        centralBrainReverseWatchEnabled: state.centralBrainReverseWatchEnabled,
        orchestratorDisplayName: state.orchestratorDisplayName,
        orchestratorPersonalityEnabled: state.orchestratorPersonalityEnabled,
        orchestratorSoulEnabled: state.orchestratorSoulEnabled,
        narratorMode: state.narratorMode,
        narratorAiModelId: state.narratorAiModelId,
        memoryShortTermMaxChars: state.memoryShortTermMaxChars,
        memoryLongTermEnabled: state.memoryLongTermEnabled,
        memoryLongTermSource: state.memoryLongTermSource,
        memoryLongTermMaxChars: state.memoryLongTermMaxChars,
        orcaUserProfileEnabled: state.orcaUserProfileEnabled,
        orcaUserProfileSource: state.orcaUserProfileSource,
        orcaUserProfileMaxChars: state.orcaUserProfileMaxChars,
        orcaUserProfileDistillerEnabled: state.orcaUserProfileDistillerEnabled,
        orchestratorHeartbeatEnabled: state.orchestratorHeartbeatEnabled,
        orchestratorHeartbeatIntervalMinutes: state.orchestratorHeartbeatIntervalMinutes,
        orchestratorAutonomyMode: state.orchestratorAutonomyMode,
        intelligentLayoutEnabled: state.intelligentLayoutEnabled,
        intelligentLayoutAnchorRatio: state.intelligentLayoutAnchorRatio,
        intelligentLayoutAutoDetectAnchor: state.intelligentLayoutAutoDetectAnchor,
        picassoMode: state.picassoMode,
        oneShotArchitectureDiagramMode: state.oneShotArchitectureDiagramMode,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined
        const persistedHybridPolicies = normalizeHybridRuntimePolicies(
          p?.hybridRuntimePolicies,
          current.hybridRuntimePolicies
        )
        const resolvedHybrid = resolveHybridProviderConfigState(
          p?.hybridProviderConfigJson,
          persistedHybridPolicies
        )
        const persistedHybridAuthProfiles = normalizeHybridAuthProfiles(
          p?.hybridAuthProfiles,
          current.hybridAuthProfiles
        )
        const merged: SettingsState = {
          ...current,
          ...p,
          selectedModel: resolveSelectedModelForProviderConfig(
            p?.selectedModel ?? current.selectedModel,
            {
              ...current.providers,
              ...p?.providers,
              openrouter: {
                ...current.providers.openrouter,
                ...p?.providers?.openrouter,
                baseUrl: persistedOpenRouterBaseUrl(
                  p?.providers?.openrouter?.baseUrl ?? current.providers.openrouter.baseUrl
                ),
              },
              openai: {
                ...current.providers.openai,
                ...p?.providers?.openai,
                authMode: normalizeOpenAiAuthMode(
                  p?.providers?.openai?.authMode ?? current.providers.openai.authMode
                ),
                useResponsesApi:
                  normalizeOpenAiAuthMode(
                    p?.providers?.openai?.authMode ?? current.providers.openai.authMode
                  ) === 'oauth'
                    ? false
                    : !!(p?.providers?.openai?.useResponsesApi ?? current.providers.openai.useResponsesApi),
              },
              zai: {
                ...current.providers.zai,
                ...p?.providers?.zai,
                baseUrl: persistedZaiBaseUrl(p?.providers?.zai?.baseUrl ?? current.providers.zai.baseUrl),
              },
              hermes: {
                ...current.providers.hermes,
                ...p?.providers?.hermes,
              },
            }
          ),
          hermesOrchestratorMode:
            typeof (p as Partial<SettingsState>)?.hermesOrchestratorMode === 'boolean'
              ? Boolean((p as Partial<SettingsState>).hermesOrchestratorMode)
              : current.hermesOrchestratorMode,
          hermesOrchestratorAutoDetect:
            typeof (p as Partial<SettingsState>)?.hermesOrchestratorAutoDetect === 'boolean'
              ? Boolean((p as Partial<SettingsState>).hermesOrchestratorAutoDetect)
              : current.hermesOrchestratorAutoDetect,
          hermesApiBaseUrl: normalizeHermesApiBaseUrl(
            typeof (p as Partial<SettingsState>)?.hermesApiBaseUrl === 'string'
              ? ((p as Partial<SettingsState>).hermesApiBaseUrl as string)
              : current.hermesApiBaseUrl
          ),
          hermesApiKey: (() => {
            const raw = (p as Partial<SettingsState>)?.hermesApiKey
            if (raw === undefined || raw === null) return current.hermesApiKey
            const s = sanitizeHermesApiKeyForStorage(raw)
            // Empty must stay empty (open gateway). Never coerce to local-dev-key — that breaks no-auth Hermes.
            return s
          })(),
          hermesModel:
            typeof (p as Partial<SettingsState>)?.hermesModel === 'string' &&
            (p as Partial<SettingsState>).hermesModel?.trim()
              ? String((p as Partial<SettingsState>).hermesModel).trim()
              : current.hermesModel,
          hermesAutoRunnerForSubAgents:
            typeof (p as Partial<SettingsState>)?.hermesAutoRunnerForSubAgents === 'boolean'
              ? Boolean((p as Partial<SettingsState>).hermesAutoRunnerForSubAgents)
              : current.hermesAutoRunnerForSubAgents,
          showHermesAgentTile:
            typeof (p as Partial<SettingsState>)?.showHermesAgentTile === 'boolean'
              ? Boolean((p as Partial<SettingsState>).showHermesAgentTile)
              : current.showHermesAgentTile,
          orcaTelegramBotToken:
            typeof (p as Partial<SettingsState>)?.orcaTelegramBotToken === 'string'
              ? String((p as Partial<SettingsState>).orcaTelegramBotToken)
              : current.orcaTelegramBotToken,
          orcaTelegramAllowedUserIds:
            typeof (p as Partial<SettingsState>)?.orcaTelegramAllowedUserIds === 'string'
              ? String((p as Partial<SettingsState>).orcaTelegramAllowedUserIds)
              : current.orcaTelegramAllowedUserIds,
          orcaTelegramGatewayStartKnown:
            typeof (p as Partial<SettingsState>)?.orcaTelegramGatewayStartKnown === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaTelegramGatewayStartKnown)
              : current.orcaTelegramGatewayStartKnown,
          providers: {
            ...current.providers,
            ...p?.providers,
            openrouter: {
              ...current.providers.openrouter,
              ...p?.providers?.openrouter,
              baseUrl: persistedOpenRouterBaseUrl(
                p?.providers?.openrouter?.baseUrl ?? current.providers.openrouter.baseUrl
              ),
            },
            openai: {
              ...current.providers.openai,
              ...p?.providers?.openai,
              authMode: normalizeOpenAiAuthMode(
                p?.providers?.openai?.authMode ?? current.providers.openai.authMode
              ),
              useResponsesApi:
                normalizeOpenAiAuthMode(
                  p?.providers?.openai?.authMode ?? current.providers.openai.authMode
                ) === 'oauth'
                  ? false
                  : !!(p?.providers?.openai?.useResponsesApi ?? current.providers.openai.useResponsesApi),
            },
            zai: {
              ...current.providers.zai,
              ...p?.providers?.zai,
              baseUrl: persistedZaiBaseUrl(p?.providers?.zai?.baseUrl ?? current.providers.zai.baseUrl),
            },
            hermes: {
              ...current.providers.hermes,
              ...p?.providers?.hermes,
            },
          },
          hybridProviderConfigJson: resolvedHybrid.hybridProviderConfigJson,
          hybridProviderConfigErrors: resolvedHybrid.hybridProviderConfigErrors,
          hybridProviderConfig: resolvedHybrid.hybridProviderConfig,
          hybridRuntimePolicies: resolvedHybrid.hybridRuntimePolicies,
          hybridAuthProfiles: persistedHybridAuthProfiles,
          canvasTheme: normalizeCanvasThemeId(p?.canvasTheme ?? current.canvasTheme),
          ambientParticlesEnabled:
            typeof p?.ambientParticlesEnabled === 'boolean'
              ? p.ambientParticlesEnabled
              : current.ambientParticlesEnabled,
          changelogAutomationEnabled:
            typeof p?.changelogAutomationEnabled === 'boolean'
              ? p.changelogAutomationEnabled
              : true,
          researchAutomationEnabled:
            typeof (p as Partial<SettingsState>)?.researchAutomationEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).researchAutomationEnabled)
              : true,
          autoApproveMergeReviews:
            typeof (p as Partial<SettingsState>)?.autoApproveMergeReviews === 'boolean'
              ? Boolean((p as Partial<SettingsState>).autoApproveMergeReviews)
              : false,
          hybridGuiShellMode: normalizeHybridGuiShellMode(
            (p as Partial<SettingsState>)?.hybridGuiShellMode
          ),
          uiTheme: normalizeUiThemeId(p?.uiTheme),
          tileBorderAnimation: normalizeTileBorderAnimationId(p?.tileBorderAnimation),
          visualEffectsPreset: normalizeVisualEffectsPresetId(
            (p as Partial<SettingsState>)?.visualEffectsPreset
          ),
          orchestratorHubLinksVisible:
            typeof (p as Partial<SettingsState>)?.orchestratorHubLinksVisible === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorHubLinksVisible)
              : current.orchestratorHubLinksVisible,
          orchestratorHubLinksMotionEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorHubLinksMotionEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorHubLinksMotionEnabled)
              : current.orchestratorHubLinksMotionEnabled,
          hubLinksIntensityScale: normalizeHubScale(
            (p as Partial<SettingsState>)?.hubLinksIntensityScale,
            current.hubLinksIntensityScale,
            0,
            1.5
          ),
          hubLinksSpeedScale: normalizeHubScale(
            (p as Partial<SettingsState>)?.hubLinksSpeedScale,
            current.hubLinksSpeedScale,
            0.45,
            2
          ),
          tileIdleGlowEnabled:
            typeof (p as Partial<SettingsState>)?.tileIdleGlowEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).tileIdleGlowEnabled)
              : current.tileIdleGlowEnabled,
          tileIdleGlowStrength: normalizeHubScale(
            (p as Partial<SettingsState>)?.tileIdleGlowStrength,
            current.tileIdleGlowStrength,
            0,
            1.5
          ),
          shootingStarSpeedScale: normalizeHubScale(
            (p as Partial<SettingsState>)?.shootingStarSpeedScale,
            current.shootingStarSpeedScale,
            0.45,
            2
          ),
          shootingStarsHonorReducedMotion:
            typeof (p as Partial<SettingsState>)?.shootingStarsHonorReducedMotion === 'boolean'
              ? Boolean((p as Partial<SettingsState>).shootingStarsHonorReducedMotion)
              : current.shootingStarsHonorReducedMotion,
          respectPrefersReducedMotion:
            typeof (p as Partial<SettingsState>)?.respectPrefersReducedMotion === 'boolean'
              ? Boolean((p as Partial<SettingsState>).respectPrefersReducedMotion)
              : current.respectPrefersReducedMotion,
          onlyAnimateFocusedTile:
            typeof (p as Partial<SettingsState>)?.onlyAnimateFocusedTile === 'boolean'
              ? Boolean((p as Partial<SettingsState>).onlyAnimateFocusedTile)
              : current.onlyAnimateFocusedTile,
          orchestratorTileRevealEffectsEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorTileRevealEffectsEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorTileRevealEffectsEnabled)
              : current.orchestratorTileRevealEffectsEnabled,
          editorAgentLineAnimationsEnabled:
            typeof (p as Partial<SettingsState>)?.editorAgentLineAnimationsEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).editorAgentLineAnimationsEnabled)
              : current.editorAgentLineAnimationsEnabled,
          editorAutoSaveEnabled:
            typeof (p as Partial<SettingsState>)?.editorAutoSaveEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).editorAutoSaveEnabled)
              : current.editorAutoSaveEnabled,
          editorWordWrap:
            (p as Partial<SettingsState>)?.editorWordWrap === 'on' ||
            (p as Partial<SettingsState>)?.editorWordWrap === 'off'
              ? (p as Partial<SettingsState>).editorWordWrap!
              : current.editorWordWrap,
          obsidianBrainGraphAnimationEnabled:
            typeof (p as Partial<SettingsState>)?.obsidianBrainGraphAnimationEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).obsidianBrainGraphAnimationEnabled)
              : current.obsidianBrainGraphAnimationEnabled,
          agentWriteStreamEnabled:
            typeof (p as Partial<SettingsState>)?.agentWriteStreamEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).agentWriteStreamEnabled)
              : current.agentWriteStreamEnabled,
          tileRepulsionStrength: normalizeHubScale(
            (p as Partial<SettingsState>)?.tileRepulsionStrength,
            current.tileRepulsionStrength,
            0,
            1.5
          ),
          graphLinksDelegationEnabled:
            typeof (p as Partial<SettingsState>)?.graphLinksDelegationEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphLinksDelegationEnabled)
              : current.graphLinksDelegationEnabled,
          graphLinksDataFlowEnabled:
            typeof (p as Partial<SettingsState>)?.graphLinksDataFlowEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphLinksDataFlowEnabled)
              : current.graphLinksDataFlowEnabled,
          graphLinksManualEnabled:
            typeof (p as Partial<SettingsState>)?.graphLinksManualEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphLinksManualEnabled)
              : current.graphLinksManualEnabled,
          graphPhysicsStrength: normalizeHubScale(
            (p as Partial<SettingsState>)?.graphPhysicsStrength,
            current.graphPhysicsStrength,
            0.2,
            2
          ),
          graphNodeScale: normalizeHubScale(
            (p as Partial<SettingsState>)?.graphNodeScale,
            current.graphNodeScale,
            0.6,
            1.8
          ),
          graphSyncOnExit:
            typeof (p as Partial<SettingsState>)?.graphSyncOnExit === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphSyncOnExit)
              : current.graphSyncOnExit,
          tileLiveMagneticDragEnabled:
            typeof (p as Partial<SettingsState>)?.tileLiveMagneticDragEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).tileLiveMagneticDragEnabled)
              : current.tileLiveMagneticDragEnabled,
          orchestratorGroupFollowEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorGroupFollowEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorGroupFollowEnabled)
              : current.orchestratorGroupFollowEnabled,
          orchestratorGroupFollowStrength: normalizeHubScale(
            (p as Partial<SettingsState>)?.orchestratorGroupFollowStrength,
            current.orchestratorGroupFollowStrength,
            0.2,
            1
          ),
          graphLiveMagneticDragEnabled:
            typeof (p as Partial<SettingsState>)?.graphLiveMagneticDragEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphLiveMagneticDragEnabled)
              : current.graphLiveMagneticDragEnabled,
          graphAdvancedWorkflowEnabled:
            typeof (p as Partial<SettingsState>)?.graphAdvancedWorkflowEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).graphAdvancedWorkflowEnabled)
              : current.graphAdvancedWorkflowEnabled,
          graphContextRadius:
            typeof (p as Partial<SettingsState>)?.graphContextRadius === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).graphContextRadius as number)
              ? Math.max(
                  120,
                  Math.min(1600, Math.round((p as Partial<SettingsState>).graphContextRadius as number))
                )
              : current.graphContextRadius,
          orchestratorDelegationLineMode: normalizeOrchestratorDelegationLineMode(
            (p as Partial<SettingsState>)?.orchestratorDelegationLineMode,
            current.orchestratorDelegationLineMode
          ),
          tilePicker: normalizeTilePickerPreferences(
            p?.tilePicker,
            current.tilePicker ?? defaultTilePickerPreferences()
          ),
          tilePickerAddCounts: normalizeTilePickerAddCounts(
            (p as Partial<SettingsState> | undefined)?.tilePickerAddCounts,
            current.tilePickerAddCounts ?? defaultTilePickerAddCounts()
          ),
          remotionOutputDir:
            typeof p?.remotionOutputDir === 'string' && p.remotionOutputDir.trim()
              ? p.remotionOutputDir.replace(/^\/+/, '').trim()
              : current.remotionOutputDir,
          subAgentSimpleModelId:
            p && 'subAgentSimpleModelId' in p
              ? p.subAgentSimpleModelId ?? null
              : current.subAgentSimpleModelId,
          subAgentComplexModelId:
            p && 'subAgentComplexModelId' in p
              ? p.subAgentComplexModelId ?? null
              : current.subAgentComplexModelId,
          zaiPlanTier: normalizeZaiPlanTier(
            (p as Partial<SettingsState>)?.zaiPlanTier ?? current.zaiPlanTier
          ),
          zaiMinMsBetweenRounds: normalizeZaiMinMsBetweenRounds(
            (p as Partial<SettingsState>)?.zaiMinMsBetweenRounds ?? current.zaiMinMsBetweenRounds
          ),
          zaiQueueMinGapMs: normalizeZaiQueueMinGapMs(
            (p as Partial<SettingsState>)?.zaiQueueMinGapMs ?? current.zaiQueueMinGapMs
          ),
          openrouterRateLimitFallbackEnabled:
            typeof (p as Partial<SettingsState>)?.openrouterRateLimitFallbackEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).openrouterRateLimitFallbackEnabled)
              : current.openrouterRateLimitFallbackEnabled,
          openrouterRateLimitFallbackModelId: (() => {
            const raw = (p as Partial<SettingsState>)?.openrouterRateLimitFallbackModelId
            if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
            return current.openrouterRateLimitFallbackModelId
          })(),
          openrouterRateLimitFallbackMinutes: (() => {
            const raw = (p as Partial<SettingsState>)?.openrouterRateLimitFallbackMinutes
            if (typeof raw === 'number' && Number.isFinite(raw)) {
              return Math.min(60, Math.max(1, Math.floor(raw)))
            }
            return current.openrouterRateLimitFallbackMinutes
          })(),
          orchestratorLeadDelegationOnly:
            typeof (p as Partial<SettingsState>)?.orchestratorLeadDelegationOnly === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorLeadDelegationOnly)
              : current.orchestratorLeadDelegationOnly,
          orchestratorArticulationMode: normalizeOrchestratorArticulationMode(
            (p as Partial<SettingsState>)?.orchestratorArticulationMode ?? current.orchestratorArticulationMode
          ),
          harnessTraceRaw:
            typeof (p as Partial<SettingsState>)?.harnessTraceRaw === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessTraceRaw)
              : current.harnessTraceRaw,
          harnessTraceDetailed:
            typeof (p as Partial<SettingsState>)?.harnessTraceDetailed === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessTraceDetailed)
              : current.harnessTraceDetailed,
          harnessFileStateSnapshot:
            typeof (p as Partial<SettingsState>)?.harnessFileStateSnapshot === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessFileStateSnapshot)
              : current.harnessFileStateSnapshot,
          harnessSafetyMode: normalizeHarnessSafetyMode(
            (p as Partial<SettingsState>)?.harnessSafetyMode,
            current.harnessSafetyMode
          ),
          harnessStagnationGuard:
            typeof (p as Partial<SettingsState>)?.harnessStagnationGuard === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessStagnationGuard)
              : current.harnessStagnationGuard,
          harnessInspectErrorDetection:
            typeof (p as Partial<SettingsState>)?.harnessInspectErrorDetection === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessInspectErrorDetection)
              : current.harnessInspectErrorDetection,
          harnessAutoFixGate:
            typeof (p as Partial<SettingsState>)?.harnessAutoFixGate === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessAutoFixGate)
              : current.harnessAutoFixGate,
          harnessParallelBatchRules:
            typeof (p as Partial<SettingsState>)?.harnessParallelBatchRules === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessParallelBatchRules)
              : current.harnessParallelBatchRules,
          harnessSubAgentCompactContext:
            typeof (p as Partial<SettingsState>)?.harnessSubAgentCompactContext === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessSubAgentCompactContext)
              : current.harnessSubAgentCompactContext,
          harnessTerminalReadOnlyBash:
            typeof (p as Partial<SettingsState>)?.harnessTerminalReadOnlyBash === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessTerminalReadOnlyBash)
              : current.harnessTerminalReadOnlyBash,
          harnessSubAgentAutoWorktree:
            typeof (p as Partial<SettingsState>)?.harnessSubAgentAutoWorktree === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessSubAgentAutoWorktree)
              : current.harnessSubAgentAutoWorktree,
          orcaPersistenceEnabled:
            typeof (p as Partial<SettingsState>)?.orcaPersistenceEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaPersistenceEnabled)
              : current.orcaPersistenceEnabled,
          orcaBurstAggregationEnabled:
            typeof (p as Partial<SettingsState>)?.orcaBurstAggregationEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaBurstAggregationEnabled)
              : current.orcaBurstAggregationEnabled,
          orcaBugBountyLaneEnabled:
            typeof (p as Partial<SettingsState>)?.orcaBugBountyLaneEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaBugBountyLaneEnabled)
              : current.orcaBugBountyLaneEnabled,
          orcaBugBountyAutoDelegateSubagents:
            typeof (p as Partial<SettingsState>)?.orcaBugBountyAutoDelegateSubagents === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaBugBountyAutoDelegateSubagents)
              : current.orcaBugBountyAutoDelegateSubagents,
          orcaBugBountyMaxHunters:
            typeof (p as Partial<SettingsState>)?.orcaBugBountyMaxHunters === 'number'
              ? Math.max(
                  1,
                  Math.min(
                    8,
                    Math.floor(Number((p as Partial<SettingsState>).orcaBugBountyMaxHunters)) || 3
                  )
                )
              : current.orcaBugBountyMaxHunters,
          orcaBugBountyHunterModelId:
            typeof (p as Partial<SettingsState>)?.orcaBugBountyHunterModelId === 'string'
              ? (p as Partial<SettingsState>).orcaBugBountyHunterModelId ?? null
              : (p as Partial<SettingsState>)?.orcaBugBountyHunterModelId === null
                ? null
                : current.orcaBugBountyHunterModelId,
          orcaAutoCompactionEnabled:
            typeof (p as Partial<SettingsState>)?.orcaAutoCompactionEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaAutoCompactionEnabled)
              : current.orcaAutoCompactionEnabled,
          orcaAutoCompactionThreshold:
            typeof (p as Partial<SettingsState>)?.orcaAutoCompactionThreshold === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).orcaAutoCompactionThreshold as number)
              ? Math.min(
                  500,
                  Math.max(
                    10,
                    Math.floor((p as Partial<SettingsState>).orcaAutoCompactionThreshold as number)
                  )
                )
              : current.orcaAutoCompactionThreshold,
          orcaMemoryDistillerEnabled:
            typeof (p as Partial<SettingsState>)?.orcaMemoryDistillerEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaMemoryDistillerEnabled)
              : current.orcaMemoryDistillerEnabled,
          harnessAutoApplyBestCandidate:
            typeof (p as Partial<SettingsState>)?.harnessAutoApplyBestCandidate === 'boolean'
              ? Boolean((p as Partial<SettingsState>).harnessAutoApplyBestCandidate)
              : current.harnessAutoApplyBestCandidate,
          orcaVaultBrainMirrorEnabled:
            typeof (p as Partial<SettingsState>)?.orcaVaultBrainMirrorEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultBrainMirrorEnabled)
              : current.orcaVaultBrainMirrorEnabled,
          orcaVaultBrainMirrorUserChoice:
            typeof (p as Partial<SettingsState>)?.orcaVaultBrainMirrorUserChoice === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultBrainMirrorUserChoice)
              : current.orcaVaultBrainMirrorUserChoice,
          orcaVaultMirrorErrors:
            typeof (p as Partial<SettingsState>)?.orcaVaultMirrorErrors === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultMirrorErrors)
              : current.orcaVaultMirrorErrors,
          orcaVaultMirrorSessions:
            typeof (p as Partial<SettingsState>)?.orcaVaultMirrorSessions === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultMirrorSessions)
              : current.orcaVaultMirrorSessions,
          orcaVaultMirrorTelemetry:
            typeof (p as Partial<SettingsState>)?.orcaVaultMirrorTelemetry === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultMirrorTelemetry)
              : current.orcaVaultMirrorTelemetry,
          orcaVaultMirrorChatTranscript:
            typeof (p as Partial<SettingsState>)?.orcaVaultMirrorChatTranscript === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultMirrorChatTranscript)
              : current.orcaVaultMirrorChatTranscript,
          orcaVaultWikiDistillPrompt:
            typeof (p as Partial<SettingsState>)?.orcaVaultWikiDistillPrompt === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaVaultWikiDistillPrompt)
              : current.orcaVaultWikiDistillPrompt,
          centralBrainEnabled:
            typeof (p as Partial<SettingsState>)?.centralBrainEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).centralBrainEnabled)
              : current.centralBrainEnabled,
          centralBrainVaultPath:
            typeof (p as Partial<SettingsState>)?.centralBrainVaultPath === 'string'
              ? String((p as Partial<SettingsState>).centralBrainVaultPath)
              : current.centralBrainVaultPath,
          centralBrainReverseWatchEnabled:
            typeof (p as Partial<SettingsState>)?.centralBrainReverseWatchEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).centralBrainReverseWatchEnabled)
              : current.centralBrainReverseWatchEnabled,
          orchestratorDisplayName: ((): string => {
            const raw = (p as Partial<SettingsState>)?.orchestratorDisplayName
            if (typeof raw !== 'string') return current.orchestratorDisplayName
            const cleaned = raw.replace(/[·\r\n\t]/g, ' ').trim().slice(0, 48)
            return cleaned.length > 0 ? cleaned : current.orchestratorDisplayName
          })(),
          orchestratorPersonalityEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorPersonalityEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorPersonalityEnabled)
              : current.orchestratorPersonalityEnabled,
          orchestratorSoulEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorSoulEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorSoulEnabled)
              : current.orchestratorSoulEnabled,
          narratorMode:
            (p as Partial<SettingsState>)?.narratorMode === 'ai'
              ? 'ai'
              : (p as Partial<SettingsState>)?.narratorMode === 'template'
                ? 'template'
                : current.narratorMode,
          narratorAiModelId:
            typeof (p as Partial<SettingsState>)?.narratorAiModelId === 'string'
              ? ((p as Partial<SettingsState>).narratorAiModelId as string).trim() || null
              : current.narratorAiModelId,
          memoryShortTermMaxChars:
            typeof (p as Partial<SettingsState>)?.memoryShortTermMaxChars === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).memoryShortTermMaxChars as number)
              ? Math.min(
                  200_000,
                  Math.max(
                    2_000,
                    Math.floor((p as Partial<SettingsState>).memoryShortTermMaxChars as number)
                  )
                )
              : current.memoryShortTermMaxChars,
          memoryLongTermEnabled:
            typeof (p as Partial<SettingsState>)?.memoryLongTermEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).memoryLongTermEnabled)
              : current.memoryLongTermEnabled,
          memoryLongTermSource:
            (p as Partial<SettingsState>)?.memoryLongTermSource === 'workspace' ||
            (p as Partial<SettingsState>)?.memoryLongTermSource === 'user' ||
            (p as Partial<SettingsState>)?.memoryLongTermSource === 'both'
              ? ((p as Partial<SettingsState>).memoryLongTermSource as OrcaMemoryLongTermSourceId)
              : current.memoryLongTermSource,
          memoryLongTermMaxChars:
            typeof (p as Partial<SettingsState>)?.memoryLongTermMaxChars === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).memoryLongTermMaxChars as number)
              ? Math.min(
                  50_000,
                  Math.max(
                    500,
                    Math.floor((p as Partial<SettingsState>).memoryLongTermMaxChars as number)
                  )
                )
              : current.memoryLongTermMaxChars,
          orcaUserProfileEnabled:
            typeof (p as Partial<SettingsState>)?.orcaUserProfileEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaUserProfileEnabled)
              : current.orcaUserProfileEnabled,
          orcaUserProfileSource:
            (p as Partial<SettingsState>)?.orcaUserProfileSource === 'workspace' ||
            (p as Partial<SettingsState>)?.orcaUserProfileSource === 'user' ||
            (p as Partial<SettingsState>)?.orcaUserProfileSource === 'both'
              ? ((p as Partial<SettingsState>).orcaUserProfileSource as OrcaUserProfileSourceId)
              : current.orcaUserProfileSource,
          orcaUserProfileMaxChars:
            typeof (p as Partial<SettingsState>)?.orcaUserProfileMaxChars === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).orcaUserProfileMaxChars as number)
              ? Math.min(
                  8_000,
                  Math.max(
                    400,
                    Math.floor((p as Partial<SettingsState>).orcaUserProfileMaxChars as number)
                  )
                )
              : current.orcaUserProfileMaxChars,
          orcaUserProfileDistillerEnabled:
            typeof (p as Partial<SettingsState>)?.orcaUserProfileDistillerEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orcaUserProfileDistillerEnabled)
              : current.orcaUserProfileDistillerEnabled,
          orchestratorHeartbeatEnabled:
            typeof (p as Partial<SettingsState>)?.orchestratorHeartbeatEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).orchestratorHeartbeatEnabled)
              : current.orchestratorHeartbeatEnabled,
          orchestratorHeartbeatIntervalMinutes:
            typeof (p as Partial<SettingsState>)?.orchestratorHeartbeatIntervalMinutes ===
              'number' &&
            Number.isFinite(
              (p as Partial<SettingsState>).orchestratorHeartbeatIntervalMinutes as number
            )
              ? Math.min(
                  24 * 60,
                  Math.max(
                    1,
                    Math.floor(
                      (p as Partial<SettingsState>).orchestratorHeartbeatIntervalMinutes as number
                    )
                  )
                )
              : current.orchestratorHeartbeatIntervalMinutes,
          orchestratorAutonomyMode: normalizeOrchestratorAutonomyMode(
            (p as Partial<SettingsState>)?.orchestratorAutonomyMode
          ),
          intelligentLayoutEnabled:
            typeof (p as Partial<SettingsState>)?.intelligentLayoutEnabled === 'boolean'
              ? Boolean((p as Partial<SettingsState>).intelligentLayoutEnabled)
              : current.intelligentLayoutEnabled,
          intelligentLayoutAnchorRatio:
            typeof (p as Partial<SettingsState>)?.intelligentLayoutAnchorRatio === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).intelligentLayoutAnchorRatio as number)
              ? Math.min(
                  0.85,
                  Math.max(
                    0.45,
                    (p as Partial<SettingsState>).intelligentLayoutAnchorRatio as number
                  )
                )
              : current.intelligentLayoutAnchorRatio,
          intelligentLayoutAutoDetectAnchor:
            typeof (p as Partial<SettingsState>)?.intelligentLayoutAutoDetectAnchor === 'boolean'
              ? Boolean((p as Partial<SettingsState>).intelligentLayoutAutoDetectAnchor)
              : current.intelligentLayoutAutoDetectAnchor,
          picassoMode:
            typeof (p as Partial<SettingsState>)?.picassoMode === 'boolean'
              ? Boolean((p as Partial<SettingsState>).picassoMode)
              : current.picassoMode,
          oneShotArchitectureDiagramMode: normalizeOneShotArchitectureDiagramMode(
            (p as Partial<SettingsState>)?.oneShotArchitectureDiagramMode
          ),
          openaiCustomModelIds: normalizeCustomModelIds(
            (p as Partial<SettingsState>)?.openaiCustomModelIds
          ),
          openrouterCustomModelIds: normalizeCustomModelIds(
            (p as Partial<SettingsState>)?.openrouterCustomModelIds
          ),
          openrouterCatalog: normalizeOpenRouterCatalogPersisted(
            (p as Partial<SettingsState>)?.openrouterCatalog
          ),
          openrouterCatalogFetchedAt:
            typeof (p as Partial<SettingsState>)?.openrouterCatalogFetchedAt === 'number' &&
            Number.isFinite((p as Partial<SettingsState>).openrouterCatalogFetchedAt as number)
              ? ((p as Partial<SettingsState>).openrouterCatalogFetchedAt as number)
              : null,
          openrouterPreflightResults: (() => {
            const raw = (p as Partial<SettingsState>)?.openrouterPreflightResults
            if (!raw || typeof raw !== 'object') return {}
            const out: SettingsState['openrouterPreflightResults'] = {}
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
              if (!v || typeof v !== 'object') continue
              const r = v as Record<string, unknown>
              if (typeof r.status !== 'string') continue
              if (typeof r.checkedAt !== 'number' || !Number.isFinite(r.checkedAt)) continue
              out[k] = {
                status: r.status as import('../lib/openrouterPreflight').PreflightStatus,
                detail: typeof r.detail === 'string' ? r.detail : undefined,
                providerName: typeof r.providerName === 'string' ? r.providerName : undefined,
                endpointName: typeof r.endpointName === 'string' ? r.endpointName : undefined,
                checkedAt: r.checkedAt,
              }
            }
            return out
          })(),
        }
        return merged
      },
    }
  )
)
