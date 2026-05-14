/** Scroll a Monaco editor so a 1-based inclusive line range is centered. */
export function revealLineRangeInCenter(
  editor: {
    getModel: () => {
      getLineCount: () => number
      getLineMaxColumn: (lineNumber: number) => number
    } | null
    revealRangeInCenter: (range: {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
    }) => void
  },
  startLine: number,
  endLine: number
): void {
  const model = editor.getModel()
  if (!model) return
  const sl = Math.max(1, Math.min(Math.floor(startLine), model.getLineCount()))
  const el = Math.max(sl, Math.min(Math.floor(endLine), model.getLineCount()))
  editor.revealRangeInCenter({
    startLineNumber: sl,
    startColumn: 1,
    endLineNumber: el,
    endColumn: model.getLineMaxColumn(el),
  })
}
