#!/usr/bin/env node
/**
 * Copy Orca bridge skills into a Hermes (or compatible) skills directory so a fresh Hermes install can find them.
 *
 * Usage (from Orca repo root):
 *   node scripts/install-hermes-skills.mjs
 *   HERMES_SKILLS_DIR=~/.hermes/skills node scripts/install-hermes-skills.mjs
 *
 * Copies:
 *   .cursor/skills/hermes-orca-bridge   → <target>/hermes-orca-bridge
 *   docs/skills/orca-external-orchestrator → <target>/orca-external-orchestrator
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

function expandHome(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

const target = expandHome(process.env.HERMES_SKILLS_DIR?.trim() || join(homedir(), '.hermes', 'skills'))

const copies = [
  { from: join(REPO_ROOT, '.cursor/skills/hermes-orca-bridge'), to: join(target, 'hermes-orca-bridge'), name: 'hermes-orca-bridge' },
  {
    from: join(REPO_ROOT, 'docs/skills/orca-external-orchestrator'),
    to: join(target, 'orca-external-orchestrator'),
    name: 'orca-external-orchestrator',
  },
]

console.log('Orca → Hermes skills install')
console.log(`Target: ${target}\n`)

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true })
}

for (const { from, to, name } of copies) {
  if (!existsSync(from)) {
    console.error(`Skip ${name}: missing ${from}`)
    continue
  }
  if (!statSync(from).isDirectory()) {
    console.error(`Skip ${name}: not a directory ${from}`)
    continue
  }
  cpSync(from, to, { recursive: true, force: true })
  console.log(`✓ ${name}`)
}

console.log(`\nDone. Point Hermes at this folder if your install uses a custom skills path (see docs/skills/hermes/README.md).`)
