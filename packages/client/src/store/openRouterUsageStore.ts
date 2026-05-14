import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { ChatCompletionResponse, ChatCompletionUsage } from '../lib/orchestrator/types'
import { OPENROUTER_MODELS } from './settingsStore'

export interface OpenRouterUsageEvent {
  id: string
  ts: number
  modelApiName: string
  modelLabel: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  generationId?: string
}

export interface OpenRouterCreditsSnapshot {
  /** Credits used (USD) when API returns usage field */
  usageUsd?: number
  /** Credit limit (USD) if any */
  limitUsd?: number
  /** Remaining credits */
  remainingUsd?: number
  label?: string
  isFreeTier?: boolean
  fetchedAt: number
  error?: string
}

function labelForModel(apiName: string): string {
  const m = OPENROUTER_MODELS.find((x) => x.name === apiName)
  if (m) return m.displayName
  return apiName
}

function extractCostUsd(usage: ChatCompletionUsage & Record<string, unknown>): number | undefined {
  const c = usage.cost ?? usage.total_cost
  if (typeof c === 'number' && Number.isFinite(c)) return c
  return undefined
}

interface OpenRouterUsageState {
  events: OpenRouterUsageEvent[]
  credits: OpenRouterCreditsSnapshot | null
  recordFromCompletion: (modelApiName: string, res: ChatCompletionResponse) => void
  setCredits: (c: OpenRouterCreditsSnapshot | null) => void
  clearSession: () => void
}

const MAX_EVENTS = 400

export const useOpenRouterUsageStore = create<OpenRouterUsageState>()(
  persist(
    (set) => ({
      events: [],
      credits: null,

      recordFromCompletion: (modelApiName, res) => {
        const raw = res.usage
        if (!raw) return
        const prompt = Number(raw.prompt_tokens) || 0
        const completion = Number(raw.completion_tokens) || 0
        const total =
          Number(raw.total_tokens) || (prompt + completion > 0 ? prompt + completion : 0)
        if (total <= 0 && prompt <= 0 && completion <= 0) return

        const costUsd = extractCostUsd(raw as ChatCompletionUsage & Record<string, unknown>)
        const id = typeof res.id === 'string' ? res.id : undefined
        const ev: OpenRouterUsageEvent = {
          id: nanoid(),
          ts: Date.now(),
          modelApiName,
          modelLabel: labelForModel(modelApiName),
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          costUsd,
          generationId: id,
        }
        set((s) => ({
          events: [...s.events.slice(-(MAX_EVENTS - 1)), ev],
        }))
      },

      setCredits: (c) => set({ credits: c }),

      clearSession: () => set({ events: [] }),
    }),
    {
      name: 'agent-canvas-openrouter-usage',
      partialize: (s) => ({ events: s.events.slice(-250) }),
    }
  )
)

export function aggregateByModel(events: OpenRouterUsageEvent[]) {
  const map = new Map<
    string,
    { label: string; prompt: number; completion: number; total: number; costUsd: number; n: number }
  >()
  for (const e of events) {
    const key = e.modelApiName
    const cur = map.get(key) ?? {
      label: e.modelLabel,
      prompt: 0,
      completion: 0,
      total: 0,
      costUsd: 0,
      n: 0,
    }
    cur.prompt += e.promptTokens
    cur.completion += e.completionTokens
    cur.total += e.totalTokens
    cur.costUsd += e.costUsd ?? 0
    cur.n += 1
    cur.label = e.modelLabel
    map.set(key, cur)
  }
  return [...map.entries()]
    .map(([api, v]) => ({ api, ...v }))
    .sort((a, b) => b.total - a.total)
}
