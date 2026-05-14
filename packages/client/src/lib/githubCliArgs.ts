/**
 * Split a line into argv tokens; supports "double" and 'single' quotes.
 * Used for GitHub CLI argument input (no shell — only tokenization).
 */
export function splitGhCliArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) {
        quote = null
        continue
      }
      cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (cur.length) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += c
  }
  if (cur.length) out.push(cur)
  return out
}
