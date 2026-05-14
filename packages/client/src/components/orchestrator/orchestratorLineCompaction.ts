export function compactToolLine(line: string): string | null {
  const t = line.trim()
  const start = t.match(/^→\s*([a-zA-Z0-9_:-]+)\(/)
  if (start) return `Running ${start[1]}`

  const done = t.match(/^←\s*([a-zA-Z0-9_:-]+)/)
  if (done) {
    const lower = t.toLowerCase()
    const failed = lower.includes('error') || lower.includes('ok=false') || lower.includes('failed')
    return failed ? `${done[1]} failed` : `${done[1]} done`
  }

  const phase = t.match(/^\[(phase[^\]]*)\]/i)
  if (phase) return phase[1]

  const resumed = t.match(/^\[(resumed[^\]]*)\]/i)
  if (resumed) return resumed[1]

  return null
}
