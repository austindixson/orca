/**
 * Mark static vs dynamic regions of the system prompt for API prompt caching (providers that support it).
 */

/** Placeholder: insert dynamic session state after this marker in composed prompts. */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '<!-- ORCA_DYNAMIC_CONTEXT_START -->'
