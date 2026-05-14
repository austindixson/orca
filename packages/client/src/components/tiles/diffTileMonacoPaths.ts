export function buildDiffTileMonacoPaths(tileId: string, label: string): {
  originalModelPath: string
  modifiedModelPath: string
  editorPath: string
} {
  const safeTile = encodeURIComponent(tileId.trim() || 'unknown-tile')
  const safeLabel = encodeURIComponent(label.trim() || 'untitled')
  const base = `inmemory://orca/diff/${safeTile}/${safeLabel}`
  return {
    originalModelPath: `${base}/original`,
    modifiedModelPath: `${base}/modified`,
    editorPath: `${base}/editor`,
  }
}
