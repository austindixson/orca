import { create } from 'zustand'
import { nanoid } from 'nanoid'

const MAX_EVENTS = 400
const MAX_SKILLS = 80
const MAX_LEARNINGS = 40

export interface ToolboxToolEvent {
  id: string
  ts: number
  tool: string
  argsPreview: string
  ok: boolean
  /** Truncated tool result returned to the model */
  resultPreview: string
}

export interface ToolboxSkillArtifact {
  id: string
  ts: number
  skillSlug: string
  title: string
  description: string
  paths: string[]
  slashCommand: string
}

/** Heuristic nudge when the same tool failed then succeeded — prompt to codify with create_project_skill */
export interface ToolboxLearningHint {
  id: string
  ts: number
  tool: string
  title: string
  detail: string
}

interface ToolboxSessionState {
  events: ToolboxToolEvent[]
  skills: ToolboxSkillArtifact[]
  learningHints: ToolboxLearningHint[]
  appendToolEvent: (e: Omit<ToolboxToolEvent, 'id' | 'ts'>) => void
  appendSkillArtifact: (s: Omit<ToolboxSkillArtifact, 'id' | 'ts'>) => void
  clear: () => void
  dismissLearning: (id: string) => void
}

function pushRecoveryHint(
  set: (fn: (s: ToolboxSessionState) => Partial<ToolboxSessionState>) => void,
  newer: ToolboxToolEvent,
  older: ToolboxToolEvent | undefined
): void {
  if (!older) return
  if (older.tool !== newer.tool) return
  if (older.ok !== false || newer.ok !== true) return

  const hint: ToolboxLearningHint = {
    id: nanoid(10),
    ts: Date.now(),
    tool: newer.tool,
    title: `Recovered: ${newer.tool}`,
    detail:
      `This tool failed once, then succeeded. Capture the **working** steps or args with **create_project_skill** ` +
      `(e.g. slug \`${newer.tool.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 32) || 'workflow'}-recipe\`) ` +
      `so the next run skips the blind alley — include exact commands, paths, and pitfalls.`,
  }
  set((s) => ({
    learningHints: [hint, ...s.learningHints].slice(0, MAX_LEARNINGS),
  }))
}

export const useToolboxSessionStore = create<ToolboxSessionState>((set) => ({
  events: [],
  skills: [],
  learningHints: [],

  appendToolEvent: (e) => {
    const row: ToolboxToolEvent = { ...e, id: nanoid(10), ts: Date.now() }
    let older: ToolboxToolEvent | undefined
    set((s) => {
      older = s.events[0]
      const next = [row, ...s.events].slice(0, MAX_EVENTS)
      return { events: next }
    })
    pushRecoveryHint(set, row, older)
  },

  appendSkillArtifact: (s) => {
    const row: ToolboxSkillArtifact = { ...s, id: nanoid(10), ts: Date.now() }
    set((state) => ({
      skills: [row, ...state.skills].slice(0, MAX_SKILLS),
    }))
  },

  clear: () => set({ events: [], skills: [], learningHints: [] }),

  dismissLearning: (id) =>
    set((s) => ({
      learningHints: s.learningHints.filter((h) => h.id !== id),
    })),
}))
