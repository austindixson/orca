#!/usr/bin/env node
/**
 * Lightweight parity with "agent doctor" style CLIs: quick local checks for Orca + canvas bridge.
 * Does not start servers; run `npm run dev` separately when testing HTTP.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = (process.env.CANVAS_BRIDGE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')

async function checkHealth() {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 3500)
    const r = await fetch(`${base}/api/health`, { signal: ac.signal })
    clearTimeout(t)
    const line = `GET ${base}/api/health → ${r.status} ${r.ok ? 'ok' : 'unexpected'}`
    return { ok: r.ok, line }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      line: `GET ${base}/api/health → failed (${msg}). Is the bridge up? (npm run dev)`,
    }
  }
}

async function checkBridgeStatus() {
  try {
    const headers = {}
    const tok = process.env.CANVAS_BRIDGE_TOKEN
    if (tok) headers.Authorization = `Bearer ${tok}`
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 3500)
    const r = await fetch(`${base}/api/canvas/bridge-status`, { headers, signal: ac.signal })
    clearTimeout(t)
    const body = await r.text()
    const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body
    return {
      ok: r.ok,
      line: `GET ${base}/api/canvas/bridge-status → ${r.status} ${preview}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, line: `bridge-status: ${msg}` }
  }
}

async function main() {
  console.log('Orca doctor — local checks\n')

  const h = await checkHealth()
  console.log(h.line)
  const s = await checkBridgeStatus()
  console.log(s.line)

  const tok = process.env.CANVAS_BRIDGE_TOKEN
  console.log(`\nCANVAS_BRIDGE_TOKEN: ${tok ? '(set)' : '(unset — dev often open on localhost)'}`)

  const orcaHome = join(homedir(), '.orca')
  const fts = join(orcaHome, 'session-index.sqlite')
  const mem = join(orcaHome, 'MEMORY.md')
  console.log(`\n~/.orca/session-index.sqlite (desktop FTS): ${existsSync(fts) ? 'found' : 'missing'}`)
  console.log(`~/.orca/MEMORY.md: ${existsSync(mem) ? 'found' : 'absent'}`)
  console.log('\nRuntime: native Orca (Tauri) provides FTS + workspace FS; browser dev is limited — see Settings → Memory.')
  console.log('Smoke: npm run bridge:smoke')

  const exitCode = h.ok ? 0 : 1
  process.exit(exitCode)
}

main()
