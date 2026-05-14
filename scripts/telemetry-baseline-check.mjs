#!/usr/bin/env node
/**
 * Scan dev telemetry CSV export(s) and fail if baseline thresholds are exceeded.
 * Usage: node scripts/telemetry-baseline-check.mjs [file.csv | directory]
 */

import fs from 'node:fs'
import path from 'node:path'

const THRESHOLDS = {
  failTerminalTimeouts: 55,
  failUnassignedRatio: 0.85,
  failStillWaiting: 200,
  failRateLimitSignals: 120,
  warnTerminalTimeouts: 20,
  warnUnassignedRatio: 0.35,
}

function collectCsvPaths(target) {
  const st = fs.statSync(target)
  if (st.isFile()) return [target]
  if (st.isDirectory()) {
    return fs
      .readdirSync(target)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => path.join(target, f))
  }
  throw new Error(`Not a file or directory: ${target}`)
}

function scanText(text) {
  const terminalTimeout = (text.match(/Terminal connection timed out/g) || []).length
  const stillWaiting = (text.match(/Still waiting/g) || []).length
  let rateLimit = 0
  rateLimit += (text.match(/Rate limited/g) || []).length
  rateLimit += (text.match(/quota exceeded/gi) || []).length
  rateLimit += (text.match(/Retry\s+\d+\/\d+/gi) || []).length
  const scriptError = (text.match(/Script error/g) || []).length
  const cancelled = (text.match(/\[Cancelled\]|Run failed: Aborted|\bAborted\b/g) || []).length

  const lines = text.split(/\r?\n/).filter(Boolean)
  let dataLines = 0
  let unassigned = 0
  for (const line of lines) {
    if (line.startsWith('id,ts,kind,')) continue
    dataLines += 1
    // session_id empty: uuid,iso,kind,,,
    if (/^[^,]+,[^,]+,[^,]+,,/.test(line)) unassigned += 1
  }

  return {
    terminalTimeout,
    stillWaiting,
    rateLimit,
    scriptError,
    cancelled,
    dataLines,
    unassigned,
  }
}

function main() {
  const target = process.argv[2] || '.'
  if (!fs.existsSync(target)) {
    console.error('Path not found:', target)
    process.exit(2)
  }
  const files = collectCsvPaths(target)
  if (files.length === 0) {
    console.error('No CSV files found under', target)
    process.exit(2)
  }

  let acc = {
    terminalTimeout: 0,
    stillWaiting: 0,
    rateLimit: 0,
    scriptError: 0,
    cancelled: 0,
    dataLines: 0,
    unassigned: 0,
  }

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const s = scanText(text)
    for (const k of Object.keys(acc)) {
      acc[k] += s[k]
    }
  }

  const unassignedRatio = acc.dataLines > 0 ? acc.unassigned / acc.dataLines : 0

  const report = {
    files: files.length,
    ...acc,
    unassignedRatio: Math.round(unassignedRatio * 10_000) / 10_000,
    thresholds: THRESHOLDS,
  }
  console.log(JSON.stringify(report, null, 2))

  const failures = []
  if (acc.terminalTimeout > THRESHOLDS.failTerminalTimeouts) {
    failures.push(`terminal timeouts ${acc.terminalTimeout} > ${THRESHOLDS.failTerminalTimeouts}`)
  }
  if (unassignedRatio > THRESHOLDS.failUnassignedRatio) {
    failures.push(`unassigned ratio ${unassignedRatio} > ${THRESHOLDS.failUnassignedRatio}`)
  }
  if (acc.stillWaiting > THRESHOLDS.failStillWaiting) {
    failures.push(`still waiting ${acc.stillWaiting} > ${THRESHOLDS.failStillWaiting}`)
  }
  if (acc.rateLimit > THRESHOLDS.failRateLimitSignals) {
    failures.push(`rate limit signals ${acc.rateLimit} > ${THRESHOLDS.failRateLimitSignals}`)
  }

  if (failures.length) {
    console.error('BASELINE FAIL:', failures.join('; '))
    process.exit(1)
  }

  const warns = []
  if (acc.terminalTimeout > THRESHOLDS.warnTerminalTimeouts) {
    warns.push(`terminal timeouts ${acc.terminalTimeout} > ${THRESHOLDS.warnTerminalTimeouts} (warn)`)
  }
  if (unassignedRatio > THRESHOLDS.warnUnassignedRatio) {
    warns.push(`unassigned ratio ${unassignedRatio} > ${THRESHOLDS.warnUnassignedRatio} (warn)`)
  }
  if (warns.length) console.warn('BASELINE WARN:', warns.join('; '))
}

main()
