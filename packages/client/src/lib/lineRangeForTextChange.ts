/**
 * 1-based inclusive line range in `newText` covering the smallest region that
 * differs from `oldText` (common prefix/suffix trim). Used to scroll editors
 * to the edited section after orchestrator writes.
 */
export function lineRangeForTextChange(
  oldText: string,
  newText: string
): { startLine: number; endLine: number } {
  if (oldText === newText) {
    const n = newText.split('\n').length
    return { startLine: 1, endLine: Math.max(1, n) }
  }

  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }

  let endOld = oldLines.length - 1
  let endNew = newLines.length - 1
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--
    endNew--
  }

  if (endNew < start) {
    const line = Math.max(1, newLines.length)
    return { startLine: line, endLine: line }
  }

  return { startLine: start + 1, endLine: endNew + 1 }
}
