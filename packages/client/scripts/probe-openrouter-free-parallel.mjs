#!/usr/bin/env node
/**
 * Fire 3 parallel POSTs to OpenRouter chat completions using model `openrouter/free` (free router path).
 * Does not print API keys. Exit 0 if all succeed; 1 if any fail or OPENROUTER_API_KEY missing.
 *
 * Usage (from repo root):
 *   export OPENROUTER_API_KEY=...
 *   node packages/client/scripts/probe-openrouter-free-parallel.mjs
 */
const KEY = process.env.OPENROUTER_API_KEY?.trim()
const PARALLEL = 3
const MODEL = 'openrouter/free'
const URL = 'https://openrouter.ai/api/v1/chat/completions'

if (!KEY) {
  console.error('OPENROUTER_API_KEY is not set')
  process.exit(1)
}

const body = JSON.stringify({
  model: MODEL,
  messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
  max_tokens: 8,
})

async function one(i) {
  const t0 = Date.now()
  let status = 0
  let snippet = ''
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'orca-probe',
      },
      body,
    })
    status = res.status
    const text = await res.text()
    snippet = text.slice(0, 200).replace(/\s+/g, ' ')
  } catch (e) {
    snippet = String(e?.message ?? e).slice(0, 200)
    status = -1
  }
  const ms = Date.now() - t0
  return { i, status, ms, snippet }
}

const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => one(i)))
for (const r of results) {
  console.log(`[${r.i}] status=${r.status} ${r.ms}ms ${r.snippet}`)
}
const allOk = results.every((r) => r.status === 200)
process.exit(allOk ? 0 : 1)
