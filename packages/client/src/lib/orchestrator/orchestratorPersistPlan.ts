/** Best-effort workspace plan file — same path referenced in hierarchy execution contract. */
const PLAN_REL = '.agent-canvas/plans/current-plan.md'

export async function persistOrchestratorPlanMarkdown(markdown: string): Promise<void> {
  try {
    const { isTauri, writeFile, createDirectory } = await import('../tauri')
    if (isTauri()) {
      try {
        await createDirectory('.agent-canvas')
      } catch {
        /* exists */
      }
      try {
        await createDirectory('.agent-canvas/plans')
      } catch {
        /* exists */
      }
    }
    await writeFile(PLAN_REL, markdown)
  } catch (e) {
    console.warn('[Orchestrator] Could not write plan file', e)
  }
}
