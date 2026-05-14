/**
 * Structured one-line JSON logs for orchestrator routing matrix / E2E analysis (pipe stderr to a file).
 */
export function logRoutingMatrixEvent(event: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: 'orchestrator-routing-matrix',
    ...event,
  })
  console.error(line)
}
