/**
 * LSP client placeholder (diagnostics, hover, definition) — integrate via Tauri stdio or WASM later.
 */
export type LspServerCapabilities = {
  definitionProvider?: boolean
  hoverProvider?: boolean
  referencesProvider?: boolean
}

export function createLspClientStub(_workspaceRoot: string): {
  capabilities: LspServerCapabilities
} {
  return { capabilities: {} }
}
