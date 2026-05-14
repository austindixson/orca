#!/usr/bin/env node
/**
 * Sync canonical `docs/skills/<name>/SKILL.md` files into `.cursor/skills/<name>/SKILL.md`
 * and `.claude/skills/<name>/SKILL.md` mirrors so Cursor + Claude Code + human docs stay
 * in lockstep without `@include` magic.
 *
 * Usage:
 *   node scripts/sync-skill-copies.mjs           # write copies
 *   node scripts/sync-skill-copies.mjs --dry-run # print plan only
 *   node scripts/sync-skill-copies.mjs --check   # exit 1 if any mirror drifts (pre-commit gate)
 *
 * Scope: the five shared Orca skills called out in docs/MEMORY_ARCHITECTURE.md +
 * plans/agent_memory_consolidation_97b6a7f1.plan.md. Other skills (driver-js, visual-explainer,
 * setups/*, integrations/*, hermes/*) are not mirrored one-to-one and stay out of scope.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(__filename), '..')

const SKILLS = [
  'orca-vault-wiki',
  'orca-meta-harness',
  'hermes-orca-bridge',
  'orca-external-orchestrator',
  'orca-daemon',
]

const MIRROR_DIRS = ['.cursor/skills', '.claude/skills']
const CANONICAL_DIR = 'docs/skills'

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    check: argv.includes('--check'),
  }
}

/**
 * Rewrite relative markdown links so links resolve from `destDir` to the same repo file
 * the canonical `srcDir` pointed at. Leaves http(s)/anchor/absolute-root links alone.
 */
function rewriteRelativeMarkdownLinks(content, srcDir, destDir) {
  return content.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (match, url, title) => {
    if (/^(https?:|mailto:|#|\/)/.test(url)) return match
    const absTarget = resolve(srcDir, url)
    const rewritten = relative(destDir, absTarget).split('\\').join('/')
    return `](${rewritten}${title ?? ''})`
  })
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return null
    throw e
  }
}

async function syncOne(skill, { dryRun, check }) {
  const canonicalPath = join(REPO_ROOT, CANONICAL_DIR, skill, 'SKILL.md')
  if (!existsSync(canonicalPath)) {
    return { skill, status: 'skipped', reason: `canonical missing: ${CANONICAL_DIR}/${skill}/SKILL.md` }
  }
  const canonical = await readFile(canonicalPath, 'utf8')
  const canonicalDir = dirname(canonicalPath)
  const drifts = []
  for (const mirror of MIRROR_DIRS) {
    const mirrorPath = join(REPO_ROOT, mirror, skill, 'SKILL.md')
    const rewritten = rewriteRelativeMarkdownLinks(canonical, canonicalDir, dirname(mirrorPath))
    const existing = await readIfExists(mirrorPath)
    if (existing === rewritten) continue
    drifts.push({ mirror, mirrorPath, missing: existing === null })
    if (check) continue
    if (dryRun) continue
    await mkdir(dirname(mirrorPath), { recursive: true })
    await writeFile(mirrorPath, rewritten, 'utf8')
  }
  return { skill, status: drifts.length === 0 ? 'in-sync' : check ? 'drift' : dryRun ? 'would-write' : 'written', drifts }
}

async function main() {
  const { dryRun, check } = parseArgs(process.argv.slice(2))
  const results = []
  for (const skill of SKILLS) {
    results.push(await syncOne(skill, { dryRun, check }))
  }

  const drift = results.filter((r) => r.status === 'drift' || r.status === 'would-write' || r.status === 'written')
  const inSync = results.filter((r) => r.status === 'in-sync')
  const skipped = results.filter((r) => r.status === 'skipped')

  for (const r of results) {
    if (r.status === 'in-sync') {
      console.log(`  ok    ${r.skill}`)
      continue
    }
    if (r.status === 'skipped') {
      console.log(`  skip  ${r.skill} — ${r.reason}`)
      continue
    }
    const verb = r.status === 'drift' ? 'DRIFT' : r.status === 'would-write' ? 'would-write' : 'wrote'
    for (const d of r.drifts) {
      const tag = d.missing ? 'missing' : 'diverged'
      console.log(`  ${verb.padEnd(10)} ${r.skill} → ${d.mirror}/${r.skill}/SKILL.md (${tag})`)
    }
  }

  console.log(
    `\n${inSync.length} in-sync · ${drift.length} need${drift.length === 1 ? 's' : ''} sync · ${skipped.length} skipped`
  )

  if (check && drift.length > 0) {
    console.error('\nSkill mirrors out of sync. Run: npm run skills:sync')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
