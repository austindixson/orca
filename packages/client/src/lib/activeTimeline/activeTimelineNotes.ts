import * as tauri from '../tauri'
import type { MilestoneNote } from './buildActiveTimeline'

export const ACTIVE_TIMELINE_NOTES_RELATIVE = '.agent-canvas/active-timeline.json'

type PersistedFile = {
  version: 1
  milestones: MilestoneNote[]
}

export async function loadActiveTimelineNotes(): Promise<MilestoneNote[]> {
  try {
    const raw = await tauri.readFile(ACTIVE_TIMELINE_NOTES_RELATIVE)
    const parsed = JSON.parse(raw) as PersistedFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.milestones)) return []
    return parsed.milestones.filter(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.at === 'number' &&
        typeof m.title === 'string' &&
        typeof m.body === 'string'
    )
  } catch {
    return []
  }
}

export async function saveActiveTimelineNotes(milestones: MilestoneNote[]): Promise<void> {
  const body: PersistedFile = { version: 1, milestones }
  try {
    await tauri.createDirectory('.agent-canvas')
  } catch {
    /* exists */
  }
  await tauri.writeFile(ACTIVE_TIMELINE_NOTES_RELATIVE, JSON.stringify(body, null, 2))
}
