/**
 * Heuristic parsers for Vitest/Jest/TAP/npm test output (terminal capture).
 */

/** Minimal shape for parsing (avoids circular import with testRunStore). */
export interface TestRunParseTarget {
  rawLogLines: string[]
  pass: string[]
  fail: string[]
  details: Record<string, unknown>
}

const VITEST_PASS = /✓\s+(.+)/ 
const VITEST_FAIL = /×\s+(.+)|✗\s+(.+)/
const JEST_OK = /✓\s+(.+)/ 
const TAP_OK = /^ok\s+\d+\s*-?\s*(.*)$/i
const TAP_NOT = /^not ok\s+\d+\s*-?\s*(.*)$/i
const SUMMARY = /(\d+)\s+passed.*?(\d+)\s+failed|Tests:\s*(\d+)\s*failed|(\d+)\s+tests?\s+passed/i

export function parseTestOutputLine(line: string, run: TestRunParseTarget): void {
  const t = stripAnsi(line)
  let m = t.match(VITEST_PASS) || t.match(JEST_OK)
  if (m?.[1]) {
    run.pass.push(m[1].trim())
    return
  }
  m = t.match(VITEST_FAIL)
  if (m) {
    const name = (m[1] || m[2] || '').trim()
    if (name) run.fail.push(name)
    return
  }
  m = t.match(TAP_OK)
  if (m?.[1]) {
    run.pass.push(m[1].trim())
    return
  }
  m = t.match(TAP_NOT)
  if (m?.[1]) {
    run.fail.push(m[1].trim())
  }
}

export function applySummaryLine(line: string, run: TestRunParseTarget): void {
  const t = stripAnsi(line)
  if (SUMMARY.test(t)) {
    run.details.summaryLine = t
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
}

export function finalizeTestRun(run: TestRunParseTarget, exitCode?: number): void {
  if (run.rawLogLines.length > 0 && run.pass.length === 0 && run.fail.length === 0) {
    const tail = run.rawLogLines.slice(-40).join('\n')
    const passed = tail.match(/(\d+)\s+passed/i)
    const failed = tail.match(/(\d+)\s+failed/i)
    if (passed || failed) {
      run.details.parsedSummary = { passed: passed?.[1], failed: failed?.[1] }
    }
  }
  if (exitCode !== undefined) {
    run.details.exitCode = exitCode
  }
}
