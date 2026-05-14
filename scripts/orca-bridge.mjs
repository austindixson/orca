#!/usr/bin/env node
/**
 * Orca canvas bridge CLI — same contract as GET/POST /api/canvas/* on packages/server (:3001).
 *
 * Usage:
 *   npm run orca:bridge -- status
 *   npm run orca:bridge -- tools
 *   npm run orca:bridge -- execute canvas_list_modules '{}'
 *
 * Env (optional):
 *   CANVAS_BRIDGE_URL   default http://127.0.0.1:3001
 *   CANVAS_BRIDGE_TOKEN if server sets CANVAS_BRIDGE_TOKEN
 */
import process from 'node:process'

const base = (process.env.CANVAS_BRIDGE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

function authHeaders() {
  const tok = process.env.CANVAS_BRIDGE_TOKEN?.trim()
  const h = { Accept: 'application/json' }
  if (tok) h.Authorization = `Bearer ${tok}`
  return h
}

async function getJson(path) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 12000)
  const r = await fetch(`${base}${path}`, { headers: authHeaders(), signal: ac.signal })
  clearTimeout(t)
  const text = await r.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: r.ok, status: r.status, body }
}

async function postJson(path, payload) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 120000)
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ac.signal,
  })
  clearTimeout(t)
  const text = await r.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: r.ok, status: r.status, body }
}

async function cmdStatus() {
  console.log(`Orca bridge — ${base}\n`)

  const health = await getJson('/api/health')
  console.log(`health:   ${health.ok ? 'ok' : 'fail'} (${health.status})`, health.ok ? JSON.stringify(health.body) : health.body)

  const bridge = await getJson('/api/canvas/bridge-status')
  console.log(`bridge:   ${bridge.ok ? 'ok' : 'fail'} (${bridge.status})`, JSON.stringify(bridge.body))

  const gw = await getJson('/api/gateway/status')
  if (gw.status === 404) {
    console.log(
      'gateway:  (skipped) no /api/gateway on this server build — native Telegram gateway API not present'
    )
  } else {
    console.log(`gateway:  ${gw.ok ? 'ok' : 'fail'} (${gw.status})`, JSON.stringify(gw.body))
  }

  if (!health.ok || !bridge.ok) process.exitCode = 1
}

async function cmdTools() {
  const r = await getJson('/api/canvas/tools')
  if (!r.ok) {
    console.error(`tools: HTTP ${r.status}`, r.body)
    process.exit(1)
  }
  console.log(JSON.stringify(r.body, null, 2))
}

async function cmdExecute(args) {
  const tool = args[0]
  if (!tool) {
    console.error('Usage: orca-bridge execute <tool> [arguments-json]')
    console.error('Example: orca-bridge execute canvas_list_modules "{}"')
    process.exit(2)
  }
  let argumentsObj = {}
  const jsonPart = args.slice(1).join(' ').trim()
  if (jsonPart) {
    try {
      argumentsObj = JSON.parse(jsonPart)
    } catch (e) {
      console.error('Invalid JSON for arguments:', e.message)
      process.exit(2)
    }
  }
  const r = await postJson('/api/canvas/execute', { tool, arguments: argumentsObj })
  console.log(JSON.stringify(r.body, null, 2))
  if (!r.ok) process.exit(1)
}

function printHelp() {
  console.log(`orca-bridge — Orca Coder canvas HTTP bridge

Commands:
  status              GET /api/health, /api/canvas/bridge-status, /api/gateway/status
  tools               GET /api/canvas/tools (pretty JSON)
  execute <tool> [json]   POST /api/canvas/execute

Env:
  CANVAS_BRIDGE_URL   (default ${base})
  CANVAS_BRIDGE_TOKEN (when server requires Bearer)

Examples:
  npm run orca:bridge -- status
  npm run orca:bridge -- execute canvas_list_modules '{}'
  npm run orca:bridge -- execute open_workspace '{"path":"/path/to/workspace"}'
`)
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] ?? 'help'

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp()
    return
  }

  if (cmd === 'status') {
    await cmdStatus()
    return
  }
  if (cmd === 'tools') {
    await cmdTools()
    return
  }
  if (cmd === 'execute') {
    await cmdExecute(argv.slice(1))
    return
  }

  console.error(`Unknown command: ${cmd}\n`)
  printHelp()
  process.exit(2)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
