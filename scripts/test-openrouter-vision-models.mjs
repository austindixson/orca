#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_IMAGE =
  '/Users/ghost/.cursor/projects/Users-ghost-Desktop-orca/assets/Screenshot_2026-04-13_at_6.39.08_AM-aaad7d8c-6606-4872-8eba-7983bf185465.png'
const ZAI_DEFAULT_BASE = 'https://api.z.ai/api/coding/paas/v4'

const VISION_MODELS = [
  { id: 'gpt-4o', provider: 'openai', name: 'gpt-4o', displayName: 'GPT-4o' },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
  {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    name: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
  },
  { id: 'claude-3-opus', provider: 'anthropic', name: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus' },
  { id: 'claude-3-haiku', provider: 'anthropic', name: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku' },
  { id: 'gemini-pro', provider: 'google', name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
  { id: 'gemini-flash', provider: 'google', name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
  { id: 'or-free-router', provider: 'openrouter', name: 'openrouter/free', displayName: 'OpenRouter Free Router' },
  { id: 'zai-glm-5v-turbo', provider: 'zai', name: 'GLM-5V-Turbo', displayName: 'GLM-5V Turbo' },
  { id: 'zai-glm-4-6v', provider: 'zai', name: 'GLM-4.6V', displayName: 'GLM-4.6V' },
  { id: 'zai-glm-4-5v', provider: 'zai', name: 'GLM-4.5V', displayName: 'GLM-4.5V' },
]

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    out[key] = value
  }
  return out
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !(key in process.env)) process.env[key] = value
  }
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

function readImageBundle(filePath) {
  const bytes = fs.readFileSync(filePath)
  const mime = mimeFromPath(filePath)
  const base64 = bytes.toString('base64')
  return {
    mime,
    base64,
    dataUrl: `data:${mime};base64,${base64}`,
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function extractProviderError(status, raw, json) {
  if (json?.error?.message) return String(json.error.message)
  if (json?.message) return String(json.message)
  return raw.slice(0, 320) || `HTTP ${status}`
}

function modelLooksVisionCapable(text) {
  const t = (text || '').toLowerCase()
  if (!t) return false
  const negativeHints = [
    "can't view images",
    'cannot view images',
    "can't see images",
    'cannot see images',
    'i do not have the ability to view images',
    'no image was provided',
    "can't analyze images",
    'cannot analyze images',
  ]
  return !negativeHints.some((h) => t.includes(h))
}

function chooseProviderConfig(provider) {
  switch (provider) {
    case 'openai':
      return {
        key: process.env.OPENAI_API_KEY,
        baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      }
    case 'anthropic':
      return {
        key: process.env.ANTHROPIC_API_KEY,
        baseUrl: 'https://api.anthropic.com/v1',
      }
    case 'google':
      return {
        key: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      }
    case 'openrouter':
      return {
        key: process.env.OPENROUTER_API_KEY,
        baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      }
    case 'zai':
      return {
        key: process.env.ZAI_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY,
        baseUrl: (process.env.ZAI_CODING_BASE_URL || process.env.ZHIPU_BASE_URL || process.env.GLM_BASE_URL || ZAI_DEFAULT_BASE).replace(
          /\/+$/,
          ''
        ),
      }
    default:
      return { key: undefined, baseUrl: '' }
  }
}

async function providerRequest(model, image, key, baseUrl, signal) {
  const prompt = 'Describe this image in 3 concise bullet points.'
  if (model.provider === 'openai') {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.name,
        temperature: 0,
        max_tokens: 180,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image.dataUrl } }] }],
      }),
      signal,
    })
  }
  if (model.provider === 'openrouter') {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.name,
        temperature: 0,
        max_tokens: 180,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image.dataUrl } }] }],
      }),
      signal,
    })
  }
  if (model.provider === 'zai') {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en' },
      body: JSON.stringify({
        model: model.name,
        temperature: 0,
        max_tokens: 180,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image.dataUrl } }] }],
      }),
      signal,
    })
  }
  if (model.provider === 'anthropic') {
    return fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.name,
        max_tokens: 220,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
            ],
          },
        ],
      }),
      signal,
    })
  }
  if (model.provider === 'google') {
    return fetch(`${baseUrl}/models/${encodeURIComponent(model.name)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.base64 } }],
          },
        ],
      }),
      signal,
    })
  }
  throw new Error(`Unsupported provider: ${model.provider}`)
}

function extractContent(model, json) {
  if (model.provider === 'anthropic') {
    const parts = Array.isArray(json?.content) ? json.content : []
    return parts.filter((p) => p?.type === 'text' && typeof p?.text === 'string').map((p) => p.text).join('\n').trim()
  }
  if (model.provider === 'google') {
    const parts = json?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return ''
    return parts.filter((p) => typeof p?.text === 'string').map((p) => p.text).join('\n').trim()
  }
  const c = json?.choices?.[0]?.message?.content
  if (typeof c === 'string') return c.trim()
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

async function testModel(model, image, timeoutMs) {
  const providerConfig = chooseProviderConfig(model.provider)
  if (!providerConfig.key) {
    return {
      model,
      ok: false,
      skipped: true,
      elapsedMs: 0,
      status: 0,
      reason: `missing API key for ${model.provider}`,
      content: '',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  const started = Date.now()
  try {
    const res = await providerRequest(model, image, providerConfig.key, providerConfig.baseUrl, controller.signal)
    const elapsedMs = Date.now() - started
    const raw = await res.text()
    const json = safeJsonParse(raw)
    if (!res.ok) {
      return {
        model,
        ok: false,
        skipped: false,
        elapsedMs,
        status: res.status,
        reason: extractProviderError(res.status, raw, json),
        content: '',
      }
    }

    const content = extractContent(model, json)
    if (!content) {
      return {
        model,
        ok: false,
        skipped: false,
        elapsedMs,
        status: res.status,
        reason: 'empty response content',
        content: '',
      }
    }
    if (!modelLooksVisionCapable(content)) {
      return {
        model,
        ok: false,
        skipped: false,
        elapsedMs,
        status: res.status,
        reason: 'response indicates no image understanding',
        content,
      }
    }
    return {
      model,
      ok: true,
      skipped: false,
      elapsedMs,
      status: res.status,
      reason: '',
      content,
    }
  } catch (err) {
    return {
      model,
      ok: false,
      skipped: false,
      elapsedMs: Date.now() - started,
      status: 0,
      reason: err instanceof Error ? err.message : String(err),
      content: '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function printPatchSuggestions(failed) {
  if (failed.length === 0) return
  console.log('\nSuggested badge cleanup list (supportsImages -> false):')
  for (const r of failed) {
    console.log(`- ${r.model.id} (${r.model.provider}/${r.model.name})`)
  }

  console.log('\nSuggested patch block:')
  console.log('*** Begin Patch')
  console.log('*** Update File: /Users/ghost/Desktop/orca/packages/client/src/store/settingsStore.ts')
  for (const r of failed) {
    console.log(`@@`)
    console.log(`-  { id: '${r.model.id}', provider: '${r.model.provider}', name: '${r.model.name}', displayName: '${r.model.displayName}', supportsImages: true },`)
    console.log(`+  { id: '${r.model.id}', provider: '${r.model.provider}', name: '${r.model.name}', displayName: '${r.model.displayName}', supportsImages: false },`)
  }
  console.log('*** End Patch')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const envPath = path.resolve(cwd, args.env || '.env')
  loadDotEnv(envPath)

  const imagePath = path.resolve(cwd, args.image || DEFAULT_IMAGE)
  if (!fs.existsSync(imagePath)) {
    console.error(`Image file not found: ${imagePath}`)
    process.exit(1)
  }
  const image = readImageBundle(imagePath)
  const timeoutMs = Number(args.timeoutMs || 60000)
  const providerFilter = args.provider ? String(args.provider).toLowerCase() : null
  const models = providerFilter
    ? VISION_MODELS.filter((m) => m.provider === providerFilter)
    : VISION_MODELS

  if (models.length === 0) {
    console.error(`No models to test for provider filter: ${providerFilter}`)
    process.exit(1)
  }

  console.log(`Testing vision-badged models with image: ${imagePath}`)
  console.log(`Model count: ${models.length}`)
  console.log('')

  const results = []
  for (const model of models) {
    process.stdout.write(`• [${model.provider}] ${model.displayName} (${model.name}) ... `)
    const result = await testModel(model, image, timeoutMs)
    results.push(result)
    if (result.skipped) {
      console.log(`SKIP (${result.reason})`)
    } else {
      console.log(result.ok ? `PASS (${result.elapsedMs}ms)` : `FAIL (${result.reason})`)
    }
  }

  console.log('\n=== Results ===')
  for (const r of results) {
    const label = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'
    console.log(
      `${label} | ${r.model.provider} | ${r.model.displayName} | ${r.model.name} | status=${r.status} | ${r.elapsedMs}ms`
    )
    if (!r.ok && !r.skipped) console.log(`  reason: ${r.reason}`)
    if (r.ok && r.content) console.log(`  sample: ${r.content.slice(0, 96).replace(/\s+/g, ' ')}${r.content.length > 96 ? '…' : ''}`)
  }

  const failed = results.filter((r) => !r.ok && !r.skipped)
  printPatchSuggestions(failed)

  const passCount = results.filter((r) => r.ok).length
  const skipCount = results.filter((r) => r.skipped).length
  const failCount = failed.length
  console.log(`\nSummary: ${passCount} pass, ${failCount} fail, ${skipCount} skipped`)

  if (failCount > 0) {
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

