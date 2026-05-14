import { ZAI_DEFAULT_BASE } from '../store/settingsStore'
import { agentFetch } from './agentFetch'
import { resolveBaseUrl } from './llmCredentials'
import { abortableSleep } from './orchestrator/abortable'
import { noteZaiRateLimit, runZaiChatCompletionQueued } from './orchestrator/orchestratorZaiQueue'

export interface VisionInputImage {
  name: string
  size: number
  dataUrl: string
}

interface VisionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
}

function zaiChatCompletionsUrl(rawBase: string): string {
  const t = rawBase.trim().replace(/\/+$/, '')
  if (/\/chat\/completions(\?|$)/.test(t)) return t
  return `${t}/chat/completions`
}

function zaiCodingBase(rawBase: string): string {
  const t = (rawBase || '').trim() || ZAI_DEFAULT_BASE
  return t.replace(/\/api\/paas\/v4/i, '/api/coding/paas/v4')
}

function isRateLimitText(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('rate') || t.includes('quota') || t.includes('429')
}

function parseZhipuErrorCode(errorText: string): string | null {
  try {
    const parsed = JSON.parse(errorText) as Record<string, unknown>
    const err = parsed.error
    if (err && typeof err === 'object') {
      const code = (err as Record<string, unknown>).code
      if (code !== undefined && code !== null) return String(code)
    }
  } catch {
    if (/\b1302\b/.test(errorText)) return '1302'
    if (/\b1305\b/.test(errorText)) return '1305'
  }
  return null
}

function parseRetryAfterMs(response: Response): number | null {
  const h = response.headers.get('Retry-After')
  if (!h) return null
  const sec = parseInt(h.trim(), 10)
  if (!Number.isNaN(sec) && sec >= 0) return Math.min(sec * 1000, 120_000)
  const when = Date.parse(h)
  if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), 120_000)
  return null
}

export async function preprocessImagesWithZai(options: {
  apiKey: string
  baseUrl?: string
  images: VisionInputImage[]
  signal?: AbortSignal
}): Promise<{ summary: string; modelUsed: string }> {
  const { apiKey, images, signal } = options
  const resolved = (await resolveBaseUrl('zai', options.baseUrl)) || options.baseUrl || ZAI_DEFAULT_BASE
  const url = zaiChatCompletionsUrl(zaiCodingBase(resolved))
  const visionModels = ['GLM-4.6V', 'GLM-4.5V']
  let lastErr = ''

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    {
      type: 'text',
      text:
        'Analyze these UI/code-related image attachments for a coding agent. Return concise, actionable notes: visible errors, UI structure, key text, file/tool hints, and implementation guidance.',
    },
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: img.dataUrl },
    })),
  ]

  for (let i = 0; i < visionModels.length; i++) {
    const model = visionModels[i]
    let shouldTryNextModel = false
    const maxAttempts = 5
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await runZaiChatCompletionQueued(signal, () =>
        agentFetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept-Language': 'en-US,en',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0.2,
            stream: false,
          }),
          signal,
        })
      )
      if (!res.ok) {
        const txt = await res.text()
        lastErr = txt || `HTTP ${res.status}`
        const code = parseZhipuErrorCode(lastErr)
        noteZaiRateLimit(res.status, code)
        const retryable =
          res.status === 429 || code === '1302' || code === '1305' || isRateLimitText(lastErr)
        shouldTryNextModel = retryable
        if (retryable && attempt < maxAttempts - 1) {
          const fromHeader = parseRetryAfterMs(res)
          const backoff = Math.min(2000 * 2 ** attempt, 45_000)
          const waitMs = fromHeader ?? Math.round(backoff * (0.85 + Math.random() * 0.3))
          await abortableSleep(waitMs, signal)
          continue
        }
        break
      }
      const json = (await res.json()) as VisionResponse
      const summary = json.choices?.[0]?.message?.content?.trim()
      if (!summary) {
        throw new Error(`Z.AI vision preprocess returned empty content (${model}).`)
      }
      return { summary, modelUsed: model }
    }
    if (i < visionModels.length - 1 && shouldTryNextModel) {
      continue
    }
    throw new Error(`Z.AI vision preprocess failed (${model}): ${lastErr}`)
  }

  throw new Error(`Z.AI vision preprocess failed: ${lastErr || 'unknown error'}`)
}
