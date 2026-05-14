export const COMPOSER_PASTE_CHAR_LIMIT = 12000
export const COMPOSER_PASTE_HEAD_LINES = 40
export const COMPOSER_PASTE_TAIL_LINES = 20

export interface PasteTruncationResult {
  text: string
  truncated: boolean
  totalLines: number
  keptLines: number
  totalChars: number
  keptChars: number
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

export function truncateComposerPaste(text: string): PasteTruncationResult {
  const totalChars = text.length
  const totalLines = countLines(text)
  if (totalChars <= COMPOSER_PASTE_CHAR_LIMIT) {
    return {
      text,
      truncated: false,
      totalLines,
      keptLines: totalLines,
      totalChars,
      keptChars: totalChars,
    }
  }

  const lines = text.split(/\r?\n/)
  const head = lines.slice(0, COMPOSER_PASTE_HEAD_LINES)
  const tail = lines.slice(-COMPOSER_PASTE_TAIL_LINES)
  const keptLines = head.length + tail.length
  const token = `[TRUNCATED: ${keptLines}/${lines.length} lines, ${Math.min(COMPOSER_PASTE_CHAR_LIMIT, totalChars)}/${totalChars} chars]`
  const body = [
    token,
    ...head,
    '…',
    ...tail,
  ].join('\n')

  const limited = body.length > COMPOSER_PASTE_CHAR_LIMIT ? body.slice(0, COMPOSER_PASTE_CHAR_LIMIT) : body
  return {
    text: limited,
    truncated: true,
    totalLines,
    keptLines,
    totalChars,
    keptChars: limited.length,
  }
}
