#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const OPENAI_CODEX_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5-codex',
  'codex-mini-latest',
]

const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
]

const OPENAI_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.1',
  'gpt-5.1-chat-latest',
  'gpt-5',
  'gpt-5-pro',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-chat-latest',
  'gpt-5.2-chat-latest',
  'o3-pro',
  'o3',
  'o4-mini',
  'o3-mini',
  'o1-pro',
  'o1',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'chatgpt-4o-latest',
  'gpt-4o-mini',
  'gpt-4-turbo',
]

function parseArgs(argv) {
  const args = { provider: 'all', timeoutMs: 20000 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--provider') args.provider = argv[++i] ?? 'all'
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i] ?? '20000')
  }
  return args
}

async function readPiAuth() {
  const authPath = path.join(os.homedir(), '.pi', 'agent', 'auth.json')
  try {
    return JSON.parse(await fs.readFile(authPath, 'utf8'))
  } catch {
    return {}
  }
}

function timeoutSignal(ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(new Error(`Timed out after ${ms}ms`)), ms)
  return { signal: c.signal, dispose: () => clearTimeout(t) }
}

function decodeChatGptAccountId(jwt) {
  try {
    const payload = JSON.parse(Buffer.from((jwt.split('.')[1] ?? ''), 'base64url').toString('utf8'))
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null
  } catch {
    return null
  }
}

async function smokeOpenAiCodex(model, token, timeoutMs) {
  const accountId = decodeChatGptAccountId(token)
  if (!accountId) throw new Error('Missing chatgpt_account_id in openai-codex token')
  const { signal, dispose } = timeoutSignal(timeoutMs)
  try {
    const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'chatgpt-account-id': accountId,
        originator: 'orca-smoke',
        'OpenAI-Beta': 'responses=experimental',
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        instructions: 'You are running a one-line model smoke test. Reply with OK.',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Reply with OK.' }] }],
        text: { verbosity: 'low' },
        include: ['reasoning.encrypted_content'],
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text()
      return { ok: false, status: response.status, detail: body.slice(0, 240) }
    }
    const reader = response.body?.getReader()
    if (!reader) return { ok: true, status: response.status, detail: 'SSE accepted (no body reader)' }
    const decoder = new TextDecoder()
    let buffer = ''
    let preview = ''
    try {
      while (preview.length < 120) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          preview = data.slice(0, 120)
          break
        }
      }
    } finally {
      reader.releaseLock()
    }
    return { ok: true, status: response.status, detail: preview || 'SSE accepted' }
  } finally {
    dispose()
  }
}

async function smokeAnthropic(model, token, timeoutMs) {
  const { signal, dispose } = timeoutSignal(timeoutMs)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
      signal,
    })
    const body = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, detail: body.slice(0, 240) }
    }
    return { ok: true, status: response.status, detail: body.slice(0, 120) }
  } finally {
    dispose()
  }
}

async function smokeOpenAi(model, token, timeoutMs) {
  const { signal, dispose } = timeoutSignal(timeoutMs)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
      }),
      signal,
    })
    const body = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, detail: body.slice(0, 240) }
    }
    return { ok: true, status: response.status, detail: body.slice(0, 120) }
  } finally {
    dispose()
  }
}

function printResult(provider, model, result) {
  const status = result.ok ? 'PASS' : result.skipped ? 'SKIP' : 'FAIL'
  const extra = result.skipped
    ? result.reason
    : `HTTP ${result.status}${result.detail ? ` · ${result.detail.replace(/\s+/g, ' ').trim()}` : ''}`
  console.log(`[${status}] ${provider.padEnd(12)} ${model.padEnd(26)} ${extra}`)
}

async function main() {
  const { provider, timeoutMs } = parseArgs(process.argv.slice(2))
  const auth = await readPiAuth()

  const plan = []
  if (provider === 'all' || provider === 'openaiCodex') {
    plan.push({
      provider: 'openaiCodex',
      models: OPENAI_CODEX_MODELS,
      token: auth?.['openai-codex']?.access || process.env.OPENAI_CODEX_TOKEN || '',
      smoke: smokeOpenAiCodex,
    })
  }
  if (provider === 'all' || provider === 'anthropic') {
    plan.push({
      provider: 'anthropic',
      models: ANTHROPIC_MODELS,
      token: auth?.anthropic?.access || process.env.ANTHROPIC_API_KEY || '',
      smoke: smokeAnthropic,
    })
  }
  if (provider === 'all' || provider === 'openai') {
    plan.push({
      provider: 'openai',
      models: OPENAI_MODELS,
      token: auth?.openai?.access || process.env.OPENAI_API_KEY || '',
      smoke: smokeOpenAi,
    })
  }

  if (plan.length === 0) {
    console.error(`Unknown provider filter: ${provider}`)
    process.exit(1)
  }

  console.log(`\nModel smoke test`)
  console.log(`Provider filter: ${provider}`)
  console.log(`Timeout: ${timeoutMs}ms per request\n`)

  let passed = 0
  let failed = 0
  let skipped = 0

  for (const entry of plan) {
    console.log(`\n${entry.provider}`)
    console.log('-'.repeat(entry.provider.length))
    if (!entry.token) {
      for (const model of entry.models) {
        skipped += 1
        printResult(entry.provider, model, { skipped: true, reason: 'No credential found' })
      }
      continue
    }
    for (const model of entry.models) {
      try {
        const result = await entry.smoke(model, entry.token, timeoutMs)
        if (result.ok) passed += 1
        else failed += 1
        printResult(entry.provider, model, result)
      } catch (error) {
        failed += 1
        const detail = error instanceof Error ? error.message : String(error)
        printResult(entry.provider, model, { ok: false, status: 0, detail })
      }
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${skipped} skipped\n`)
  process.exit(failed > 0 ? 1 : 0)
}

await main()
