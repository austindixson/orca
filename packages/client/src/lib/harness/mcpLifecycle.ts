/**
 * MCP lifecycle surface: connection status, resource listing, tool dispatch.
 * Desktop: read `.cursor/mcp.json` when present; full bridge TBD.
 */
export async function listConfiguredMcpServers(): Promise<string[]> {
  try {
    const { readFile } = await import('../tauri')
    const raw = await readFile('.cursor/mcp.json')
    const j = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    return Object.keys(j?.mcpServers ?? {})
  } catch {
    return []
  }
}
