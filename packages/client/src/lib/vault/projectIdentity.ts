/**
 * Stable project id for central brain mirroring (`Orca/brain/.project.json`).
 */

import * as tauri from '../tauri'

export function randomProjectId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface ProjectIdentity {
  id: string
  name: string
  createdAt: string
  lastSync?: string
}

const REL = 'Orca/brain/.project.json'

export async function readProjectIdentity(): Promise<ProjectIdentity | null> {
  if (!tauri.isTauri()) return null
  try {
    const raw = await tauri.readFile(REL)
    const j = JSON.parse(raw) as Partial<ProjectIdentity>
    if (typeof j.id === 'string' && j.id.length > 0 && typeof j.name === 'string') {
      return {
        id: j.id,
        name: j.name,
        createdAt: typeof j.createdAt === 'string' ? j.createdAt : new Date().toISOString(),
        lastSync: typeof j.lastSync === 'string' ? j.lastSync : undefined,
      }
    }
  } catch {
    /* missing */
  }
  return null
}

/**
 * Ensure `Orca/brain/.project.json` exists; returns identity or null if no workspace.
 */
export async function ensureProjectIdentity(): Promise<ProjectIdentity | null> {
  if (!tauri.isTauri()) return null
  const ws = await tauri.getWorkspace()
  if (!ws?.path || ws.path === '.') return null

  const existing = await readProjectIdentity()
  if (existing) {
    if (existing.name !== ws.name) {
      const next: ProjectIdentity = { ...existing, name: ws.name }
      await writeProjectIdentity(next)
      return next
    }
    return existing
  }

  const id = randomProjectId()
  const identity: ProjectIdentity = {
    id,
    name: ws.name,
    createdAt: new Date().toISOString(),
  }
  await writeProjectIdentity(identity)
  return identity
}

export async function writeProjectIdentity(identity: ProjectIdentity): Promise<void> {
  if (!tauri.isTauri()) return
  const body = `${JSON.stringify(identity, null, 2)}\n`
  await tauri.createDirectory('Orca/brain')
  await tauri.writeFile(REL, body)
}

export async function touchProjectLastSync(): Promise<void> {
  const id = await readProjectIdentity()
  if (!id) return
  const next: ProjectIdentity = {
    ...id,
    lastSync: new Date().toISOString(),
  }
  await writeProjectIdentity(next)
}
