import type { HermesLeadGraphModel } from './hermesLeadGraph'

export interface HermesLeadLensInput {
  model: HermesLeadGraphModel
  running: boolean
  iteration: number
  latestToolName: string | null
  latestToolRunning: boolean
  latestToolElapsedMs: number
  verb: string
  sessionToolDepthByKey: Record<string, number>
  toolFeed: string[]
}

export interface HermesLeadLensSnapshot {
  agentCount: number
  fileCount: number
  toolCount: number
  activeCount: number
  edgeCount: number
  intent: string
  delegationDepth: number
  delegationHotspots: number
  confidence: number
  risk: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function computeDelegationDepth(model: HermesLeadGraphModel): number {
  const adj = new Map<string, string[]>()
  for (const edge of model.edges) {
    if (edge.kind !== 'spawn') continue
    const arr = adj.get(edge.source) ?? []
    arr.push(edge.target)
    adj.set(edge.source, arr)
  }

  const stack: Array<{ id: string; depth: number }> = [{ id: 'hermes:lead', depth: 0 }]
  let maxDepth = 0
  const seen = new Set<string>()
  while (stack.length) {
    const next = stack.pop()
    if (!next) continue
    const key = `${next.id}:${next.depth}`
    if (seen.has(key)) continue
    seen.add(key)
    maxDepth = Math.max(maxDepth, next.depth)
    const children = adj.get(next.id) ?? []
    for (const id of children) stack.push({ id, depth: next.depth + 1 })
  }
  return maxDepth
}

function computeIntent(input: HermesLeadLensInput): string {
  if (input.latestToolRunning && input.latestToolName) return `Executing ${input.latestToolName}`
  if (input.running && input.latestToolName) return `Reviewing ${input.latestToolName} result`
  if (input.running && input.verb && input.verb !== 'Ready') return input.verb
  if (input.running) return 'Coordinating agents'
  return 'Idle'
}

export function computeHermesLeadLens(input: HermesLeadLensInput): HermesLeadLensSnapshot {
  const agentCount = input.model.nodes.filter((n) => n.kind === 'agent').length
  const fileCount = input.model.nodes.filter((n) => n.kind === 'file').length
  const toolCount = input.model.nodes.filter((n) => n.kind === 'tool').length
  const activeCount = input.model.nodes.filter((n) => n.status === 'working').length
  const edgeCount = input.model.edges.length
  const delegationDepth = computeDelegationDepth(input.model)
  const delegationHotspots = Object.values(input.sessionToolDepthByKey).filter((x) => x > 0).length

  const activePenalty = clamp((activeCount - 2) / 8, 0, 1)
  const depthPenalty = clamp((delegationDepth - 1) / 6, 0, 1)
  const durationPenalty = input.latestToolRunning ? clamp(input.latestToolElapsedMs / 12000, 0, 0.18) : 0
  const iterationPenalty = input.running ? clamp(input.iteration / 30, 0, 0.18) : 0

  let confidence = 0.82 - activePenalty * 0.25 - depthPenalty * 0.2 - durationPenalty - iterationPenalty
  if (!input.running) confidence += 0.08
  if (agentCount === 0 && input.running) confidence -= 0.08
  confidence = clamp(confidence, 0.05, 0.98)

  let risk = 0.16 + activePenalty * 0.55 + depthPenalty * 0.45 + durationPenalty + iterationPenalty
  if (!input.running) risk -= 0.12
  if (input.toolFeed.length === 0) risk -= 0.03
  risk = clamp(risk, 0.02, 0.95)

  return {
    agentCount,
    fileCount,
    toolCount,
    activeCount,
    edgeCount,
    intent: computeIntent(input),
    delegationDepth,
    delegationHotspots,
    confidence,
    risk,
  }
}
