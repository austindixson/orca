function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window || '__TAURI_IPC__' in window
}

/**
 * In Vite dev, map public API URLs to same-origin proxy paths so the browser is not blocked by CORS.
 * In production, returns `url` unchanged. Use {@link resolveAgentFetchUrl} before fetch in both Tauri and web.
 */
export function rewriteAgentUrlForDev(url: string): string {
  // `import.meta.env` is injected by Vite; guard so non-Vite runtimes (node test,
  // standalone scripts) don't crash on the property access.
  const viteEnv = (import.meta as { env?: { DEV?: boolean } }).env
  if (!viteEnv?.DEV) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const pq = u.pathname + u.search

  if (u.hostname === 'api.openai.com') return `/__agent-proxy/openai${pq}`
  if (u.hostname === 'api.anthropic.com') return `/__agent-proxy/anthropic${pq}`
  if (u.hostname === 'openrouter.ai' || u.hostname.endsWith('.openrouter.ai')) {
    return `/__agent-proxy/openrouter${pq}`
  }
  if (u.hostname === 'generativelanguage.googleapis.com') {
    return `/__agent-proxy/google${pq}`
  }
  if (u.hostname === 'api.z.ai') {
    return `/__agent-proxy/zai-coding${pq}`
  }
  if (u.hostname === 'open.bigmodel.cn' || u.hostname.endsWith('.bigmodel.cn')) {
    return `/__agent-proxy/zai-bigmodel${pq}`
  }
  if (
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
    (u.port === '' || u.port === '11434')
  ) {
    return `/__agent-proxy/ollama${pq}`
  }
  // llama.cpp local server (mac-code default port 8000)
  if (
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
    u.port === '8000'
  ) {
    return `/__agent-proxy/llamacpp${pq}`
  }
  // Hermes Agent API server (default 8642)
  if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '8642') {
    return `/__agent-proxy/hermes${pq}`
  }
  return url
}

/**
 * Resolve proxy paths to an absolute URL (same-origin in Vite dev). Tauri dev must use this so
 * Hermes/Ollama/etc. go through `vite.config` `__agent-proxy/*` instead of bare `127.0.0.1` (plugin-http).
 */
export function resolveAgentFetchUrl(url: string): string {
  const rewritten = rewriteAgentUrlForDev(url)
  if (typeof window !== 'undefined' && rewritten.startsWith('/')) {
    return `${window.location.origin}${rewritten}`
  }
  return rewritten
}

export async function agentFetch(url: string, init?: RequestInit): Promise<Response> {
  const resolved = resolveAgentFetchUrl(url)
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(resolved, init as Parameters<typeof tauriFetch>[1])
  }
  return fetch(resolved, init)
}
