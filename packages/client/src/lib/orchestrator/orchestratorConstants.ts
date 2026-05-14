/**
 * Agent harness tool-loop caps (`max_iterations`). `runOrchestrator` clamps to `ORCHESTRATOR_HARD_MAX_ITERATIONS`.
 */
export const ORCHESTRATOR_DEFAULT_MAX_ITERATIONS = 150
/** Cap for **simple** prompts (triage). */
export const ORCHESTRATOR_SIMPLE_MAX_ITERATIONS = 150
/** Absolute ceiling for vision+complex and any caller-provided maxIterations. */
export const ORCHESTRATOR_HARD_MAX_ITERATIONS = 150

/** When true, all tool_calls in a single assistant message run concurrently (Promise.all). */
export const ORCHESTRATOR_DEFAULT_PARALLEL_TOOLS = true

/**
 * Max parallel `spawn_sub_agent` workers when the main model is **not** Z.AI (Hermes / Claude Code–style).
 * When the selected orchestrator model is Z.AI, `getMaxConcurrentSubAgentsFromSettings()` uses `zaiPlanTier` instead.
 */
export const MAX_CONCURRENT_SUB_AGENTS = 5

/**
 * Hard cap on a single chat/completions request. Without this, a stuck HTTP connection looks like a hang.
 * User Stop still aborts immediately via AbortSignal.
 */
export const ORCHESTRATOR_CHAT_TIMEOUT_MS = 180_000

/** 1-shot optional MC clarify (JSON over SSE); shorter cap so a stuck stream cannot block the UI indefinitely. */
export const ONE_SHOT_CLARIFY_TIMEOUT_MS = 120_000

/**
 * Global per-run wall-clock budget guard for orchestrator loops.
 * Prevents pathological hangs where retries/stalls never converge.
 */
export const ORCHESTRATOR_DEFAULT_MAX_WALL_CLOCK_MS = 15 * 60_000

/**
 * Soft context-token budget from working-set estimate (`JSON chars / 4`).
 * When exceeded, the loop fails closed instead of drifting indefinitely.
 */
export const ORCHESTRATOR_DEFAULT_MAX_ESTIMATED_CONTEXT_TOKENS = 120_000
