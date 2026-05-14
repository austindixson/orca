#!/usr/bin/env node
/**
 * Backfill `Orca/chat/<sessionId>.md` from canonical `~/.orca/sessions/<id>/conversation.jsonl`.
 *
 * Usage:
 *   node scripts/rebuild-vault-markdown.mjs --workspace /path/to/vault [--dry-run] [--max 50]
 *
 * - Reads each session's `conversation.jsonl` and rebuilds the Obsidian-friendly markdown file.
 * - `--dry-run` prints what would be written; no disk writes.
 * - `--max N` caps sessions processed per invocation (default 50).
 *
 * This mirrors `mirrorOrchestratorConversationMarkdownToVault` but runs outside Tauri so you can
 * rebuild a vault after pruning or after switching away from per-turn mirroring.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const MAX_MESSAGE_CHARS = 200_000
const MAX_FILE_CHARS = 1_500_000
const DEFAULT_MAX_SESSIONS = 50

function parseArgs(argv) {
  const args = { dryRun: false, max: DEFAULT_MAX_SESSIONS, workspace: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--max' && argv[i + 1]) {
      args.max = Math.max(1, parseInt(argv[++i], 10) || DEFAULT_MAX_SESSIONS)
    } else if (a === '--workspace' && argv[i + 1]) {
      args.workspace = argv[++i]
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: rebuild-vault-markdown.mjs --workspace <path> [--dry-run] [--max N]'
      )
      process.exit(0)
    }
  }
  return args
}

function safeSessionFileSegment(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'session'
}

function applyVaultSecretRedaction(s) {
  if (!s) return ''
  return s
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-[REDACTED]')
    .replace(/(AIza[0-9A-Za-z_-]{35})/g, 'AIza[REDACTED]')
    .replace(/(ghp_[A-Za-z0-9]{30,})/g, 'ghp_[REDACTED]')
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, 'xox[REDACTED]')
    .replace(/(?:password|secret|api[_-]?key)["'\s:=]{1,4}["']?([A-Za-z0-9_\-\.]{16,})["']?/gi, (m) =>
      m.slice(0, m.indexOf(m.match(/["'\s:=]{1,4}["']?/)?.[0] ?? '') + 2) + '[REDACTED]'
    )
}

function messageContentText(msg) {
  if (!msg) return ''
  if (msg.role === 'system') return typeof msg.content === 'string' ? msg.content : ''
  if (msg.role === 'user') {
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content.map((p) => (p?.type === 'text' ? p.text : '')).filter(Boolean).join('\n')
    }
    return ''
  }
  if (msg.role === 'assistant') {
    return typeof msg.content === 'string' ? msg.content ?? '' : ''
  }
  if (msg.role === 'tool') return typeof msg.content === 'string' ? msg.content : ''
  return ''
}

function firstUserTitleLine(messages) {
  for (const m of messages) {
    if (m?.role === 'user') {
      const t = (messageContentText(m).trim().split('\n')[0] ?? '').slice(0, 120)
      if (t) return t.replace(/[#|[\]]/g, '')
    }
  }
  return 'Orca orchestrator chat'
}

function formatMessageForMarkdown(msg, index) {
  if (msg.role === 'system') {
    return `### [System]\n\n*(Orca system prompt omitted — index ${index})*\n`
  }
  if (msg.role === 'user') {
    const body = applyVaultSecretRedaction(messageContentText(msg)).slice(0, MAX_MESSAGE_CHARS)
    return `### User\n\n${body}\n`
  }
  if (msg.role === 'assistant') {
    const text = typeof msg.content === 'string' ? msg.content ?? '' : ''
    const scrubbed = applyVaultSecretRedaction(text).slice(0, MAX_MESSAGE_CHARS)
    let block = `### Assistant\n\n${scrubbed || '(no text)'}\n`
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const names = msg.tool_calls.map((tc) => tc.function?.name ?? '?').join(', ')
      block += `\n*(tool calls: ${names})*\n`
    }
    return block
  }
  if (msg.role === 'tool') {
    const body = applyVaultSecretRedaction(messageContentText(msg)).slice(0, MAX_MESSAGE_CHARS)
    const cid = (msg.tool_call_id ?? '').toString().slice(0, 24)
    return `### Tool (${cid})\n\n\`\`\`text\n${body}\n\`\`\`\n`
  }
  return ''
}

async function loadConversation(jsonlPath) {
  let raw
  try {
    raw = await fs.readFile(jsonlPath, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const row = JSON.parse(t)
      if (row?.message) out.push(row.message)
    } catch {
      /* skip malformed */
    }
  }
  return out
}

async function writeTranscript(workspace, sessionId, messages, dryRun) {
  const safeId = safeSessionFileSegment(sessionId)
  const rel = path.join('Orca', 'chat', `${safeId}.md`)
  const abs = path.join(workspace, rel)
  if (messages.length === 0) return { rel, skipped: true, reason: 'empty' }

  const title = firstUserTitleLine(messages)
  const updated = new Date().toISOString()
  let body = messages.map((m, i) => formatMessageForMarkdown(m, i)).join('\n')
  if (body.length > MAX_FILE_CHARS) {
    body =
      body.slice(0, MAX_FILE_CHARS) +
      `\n\n---\n\n*(Export truncated at ${MAX_FILE_CHARS} characters.)*\n`
  }
  const file = `---
kind: Orca orchestrator transcript
session_id: ${sessionId}
workspace: ${workspace.replace(/\\/g, '/')}
title: ${JSON.stringify(title)}
updated: ${updated}
---

# Orchestrator chat

${body}
`
  if (dryRun) return { rel, bytes: file.length, dryRun: true }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, file, 'utf8')
  return { rel, bytes: file.length, dryRun: false }
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.workspace) {
    console.error('error: --workspace <path> is required')
    process.exit(2)
  }
  const sessionsRoot = path.join(os.homedir(), '.orca', 'sessions')
  let entries
  try {
    entries = await fs.readdir(sessionsRoot, { withFileTypes: true })
  } catch (e) {
    console.error(`error: cannot read ${sessionsRoot}: ${e.message}`)
    process.exit(1)
  }
  const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name)
  dirs.sort()
  const batch = dirs.slice(0, args.max)
  console.log(
    `[rebuild] ${batch.length}/${dirs.length} sessions ${args.dryRun ? '(dry-run)' : ''} into ${args.workspace}`
  )
  let written = 0
  let skipped = 0
  for (const sessionId of batch) {
    const jsonl = path.join(sessionsRoot, sessionId, 'conversation.jsonl')
    const messages = await loadConversation(jsonl)
    try {
      const result = await writeTranscript(args.workspace, sessionId, messages, args.dryRun)
      if (result.skipped) {
        skipped++
        console.log(`  - skip ${sessionId} (${result.reason})`)
      } else {
        written++
        console.log(
          `  - ${result.dryRun ? 'would write' : 'wrote'} ${result.rel} (${result.bytes} bytes, ${messages.length} msgs)`
        )
      }
    } catch (e) {
      console.warn(`  - fail ${sessionId}: ${e.message}`)
    }
  }
  console.log(
    `[rebuild] done: ${written} ${args.dryRun ? 'pending' : 'written'}, ${skipped} skipped`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
