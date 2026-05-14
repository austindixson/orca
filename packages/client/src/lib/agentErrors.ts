import type { Provider } from '../store/settingsStore'

/**
 * Turn raw HTTP error bodies into short, readable messages (OpenAI-style JSON, Z.AI, etc.).
 */
export function formatAgentHttpError(
  status: number,
  rawBody: string,
  provider?: Provider
): string {
  const trimmed = rawBody.trim()
  let msg = trimmed

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const err = parsed.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      if (typeof e.message === 'string') msg = e.message
      else if (typeof e.msg === 'string') msg = e.msg
    } else if (typeof parsed.message === 'string') {
      msg = parsed.message
    }
  } catch {
    if (trimmed.length > 0) msg = trimmed.slice(0, 400)
    else msg = `HTTP ${status}`
  }

  return humanizeAgentError(status, msg, provider)
}

function humanizeAgentError(status: number, message: string, provider?: Provider): string {
  const m = message.trim()

  if (
    provider === 'openai' &&
    /model\.request/i.test(m)
  ) {
    return `${m}\n\n→ OpenAI desktop OAuth is signed in, but this token cannot invoke API models here. In Settings → OpenAI, switch auth mode to API key for orchestrator/agent runs, or choose another provider.`
  }

  // Z.AI / 智谱 GLM — wallet / resource-pack errors (Chinese). Coding vs general endpoints differ.
  if (/余额不足|无可用资源包|请充值/.test(m)) {
    return `${m}\n\n→ Z.AI: confirm you use the Coding endpoint (…/api/coding/paas/v4) with a Coding Plan key—not the general API base (…/api/paas/v4). Check quota and account at https://open.bigmodel.cn or Z.AI console.`
  }

  if (status === 401 || status === 403) {
    return `${m}\n\n→ Check API key and provider settings.`
  }

  if (status === 429) {
    return `${m}\n\n→ Rate limit or quota: wait, upgrade plan, or check billing on your provider’s site.`
  }

  if (provider === 'ollama' && /fetch|ECONNREFUSED|Failed to fetch/i.test(m)) {
    return `${m}\n\n→ Is Ollama running? (e.g. ollama serve on port 11434)`
  }

  if (provider === 'llamacpp' && /fetch|ECONNREFUSED|Failed to fetch/i.test(m)) {
    return `${m}\n\n→ Is llama-server running with your model? Default base URL is http://127.0.0.1:8000 — match it in Settings → llama.cpp.`
  }

  return m
}
