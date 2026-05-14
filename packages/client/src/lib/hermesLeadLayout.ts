import type { HermesLeadNode } from './hermesLeadGraph'

export interface HermesLeadPoint {
  id: string
  x: number
  y: number
}

export type HermesLeadLayoutMode = 'semantic' | 'pack' | 'auto'

export interface HermesLeadLayoutOptions {
  width: number
  height: number
  mode?: HermesLeadLayoutMode
  packThreshold?: number
  relaxIterations?: number
  interFamilyRelaxIterations?: number
  interFamilyRelaxStrength?: number
}

function spread(nodes: HermesLeadNode[], x: number, yStart: number, yEnd: number): HermesLeadPoint[] {
  if (!nodes.length) return []
  if (nodes.length === 1) return [{ id: nodes[0].id, x, y: (yStart + yEnd) / 2 }]
  const step = (yEnd - yStart) / (nodes.length - 1)
  return nodes.map((node, i) => ({ id: node.id, x, y: yStart + i * step }))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function hashString(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function packInBox(
  nodes: HermesLeadNode[],
  bounds: { x0: number; y0: number; x1: number; y1: number }
): HermesLeadPoint[] {
  if (!nodes.length) return []
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  const width = Math.max(40, bounds.x1 - bounds.x0)
  const height = Math.max(40, bounds.y1 - bounds.y0)
  const areaRatio = width / height
  const cols = clamp(Math.ceil(Math.sqrt(sorted.length * areaRatio)), 1, sorted.length)
  const rows = Math.ceil(sorted.length / cols)
  const cellW = width / cols
  const cellH = height / rows

  return sorted.map((node, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const seed = hashString(node.id)
    const jitterX = ((seed & 1023) / 1023 - 0.5) * cellW * 0.48
    const jitterY = (((seed >> 10) & 1023) / 1023 - 0.5) * cellH * 0.48
    const x = bounds.x0 + cellW * (col + 0.5) + jitterX
    const y = bounds.y0 + cellH * (row + 0.5) + jitterY
    return {
      id: node.id,
      x: clamp(x, bounds.x0 + 8, bounds.x1 - 8),
      y: clamp(y, bounds.y0 + 8, bounds.y1 - 8),
    }
  })
}

function relaxPointsInBounds(
  points: HermesLeadPoint[],
  bounds: { x0: number; y0: number; x1: number; y1: number },
  iterations: number
): HermesLeadPoint[] {
  if (points.length < 2) return points
  if (iterations <= 0) {
    const cx = (bounds.x0 + bounds.x1) / 2
    const cy = (bounds.y0 + bounds.y1) / 2
    return points.map((p) => ({
      ...p,
      x: clamp(cx + (p.x - cx) * 0.9, bounds.x0 + 8, bounds.x1 - 8),
      y: clamp(cy + (p.y - cy) * 0.9, bounds.y0 + 8, bounds.y1 - 8),
    }))
  }
  const out = points.map((p) => ({ ...p }))
  const minGap = 30

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < out.length; i += 1) {
      let pushX = 0
      let pushY = 0
      for (let j = 0; j < out.length; j += 1) {
        if (i === j) continue
        const dx = out[i].x - out[j].x
        const dy = out[i].y - out[j].y
        const dist = Math.hypot(dx, dy)
        if (dist >= minGap) continue
        if (dist < 1e-4) {
          const seed = hashString(`${out[i].id}:${out[j].id}:${iter}`)
          const angle = (seed % 360) * (Math.PI / 180)
          pushX += Math.cos(angle) * 1.5
          pushY += Math.sin(angle) * 1.5
          continue
        }
        const repel = ((minGap - dist) / minGap) * 2.2
        pushX += (dx / dist) * repel
        pushY += (dy / dist) * repel
      }
      out[i].x = clamp(out[i].x + pushX, bounds.x0 + 8, bounds.x1 - 8)
      out[i].y = clamp(out[i].y + pushY, bounds.y0 + 8, bounds.y1 - 8)
    }
  }

  return out
}

function relaxInterFamily(
  points: HermesLeadPoint[],
  kindById: Map<string, HermesLeadNode['kind']>,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  iterations: number,
  strength: number
): HermesLeadPoint[] {
  if (iterations <= 0 || points.length < 3) return points
  const out = points.map((p) => ({ ...p }))
  const normalizedStrength = clamp(strength, 0.25, 2.5)
  const minCrossGap = 52 * Math.max(0.4, normalizedStrength)

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < out.length; i += 1) {
      const kindA = kindById.get(out[i].id)
      if (!kindA || kindA === 'hermes') continue
      let pushX = 0
      let pushY = 0
      for (let j = 0; j < out.length; j += 1) {
        if (i === j) continue
        const kindB = kindById.get(out[j].id)
        if (!kindB || kindB === 'hermes' || kindB === kindA) continue
        const dx = out[i].x - out[j].x
        const dy = out[i].y - out[j].y
        const dist = Math.hypot(dx, dy)
        if (dist >= minCrossGap || dist < 1e-5) continue
        const repel = ((minCrossGap - dist) / minCrossGap) * 2.8 * Math.max(0.3, normalizedStrength)
        pushX += (dx / dist) * repel
        pushY += (dy / dist) * repel
      }
      out[i].x = clamp(out[i].x + pushX, bounds.x0 + 8, bounds.x1 - 8)
      out[i].y = clamp(out[i].y + pushY, bounds.y0 + 8, bounds.y1 - 8)
    }
  }

  if (Math.abs(normalizedStrength - 1) > 1e-6) {
    const boost = (normalizedStrength - 1) * 10
    const centerX = (bounds.x0 + bounds.x1) / 2
    const centerY = (bounds.y0 + bounds.y1) / 2
    for (let i = 0; i < out.length; i += 1) {
      const kind = kindById.get(out[i].id)
      if (!kind || kind === 'hermes') continue
      const vec =
        kind === 'agent'
          ? { x: -1, y: -0.25 }
          : kind === 'tool'
            ? { x: 1, y: -0.25 }
            : kind === 'tile'
              ? { x: 1, y: 0.25 }
              : { x: -1, y: 0.25 }
      const radialX = out[i].x - centerX
      const radialY = out[i].y - centerY
      const radialNorm = Math.max(1, Math.hypot(radialX, radialY))
      const shiftX = vec.x * boost + (radialX / radialNorm) * boost * 0.4
      const shiftY = vec.y * boost + (radialY / radialNorm) * boost * 0.4
      out[i].x = clamp(out[i].x + shiftX, bounds.x0 + 8, bounds.x1 - 8)
      out[i].y = clamp(out[i].y + shiftY, bounds.y0 + 8, bounds.y1 - 8)
    }
  }

  return out
}

function computeSemanticLayout(nodes: HermesLeadNode[], width: number, height: number): HermesLeadPoint[] {
  const centerX = width / 2
  const root = nodes.find((n) => n.id === 'hermes:lead' || n.kind === 'hermes')
  const agents = nodes.filter((n) => n.kind === 'agent')
  const tools = nodes.filter((n) => n.kind === 'tool')
  const files = nodes.filter((n) => n.kind === 'file' || n.kind === 'folder')
  const tiles = nodes.filter((n) => n.kind === 'tile')

  const placed: HermesLeadPoint[] = []
  if (root) {
    placed.push({ id: root.id, x: centerX, y: 44 })
  }

  placed.push(...spread(agents, centerX - width * 0.22, 120, Math.min(height - 180, 420)))
  placed.push(...spread(tools, centerX + width * 0.22, 120, Math.min(height - 180, 420)))
  placed.push(...spread(files, centerX - width * 0.12, Math.min(height * 0.45, 300), height - 60))
  placed.push(...spread(tiles, centerX + width * 0.12, Math.min(height * 0.5, 340), height - 60))

  const placedIds = new Set(placed.map((p) => p.id))
  const leftovers = nodes.filter((n) => !placedIds.has(n.id))
  const fallbackYStart = Math.min(height * 0.62, 420)
  placed.push(...spread(leftovers, centerX, fallbackYStart, height - 40))

  return placed
}

function computePackLayout(
  nodes: HermesLeadNode[],
  width: number,
  height: number,
  relaxIterations: number,
  interFamilyRelaxIterations: number,
  interFamilyRelaxStrength: number
): HermesLeadPoint[] {
  const root = nodes.find((n) => n.id === 'hermes:lead' || n.kind === 'hermes')
  const nonRoot = nodes.filter((n) => n.id !== root?.id)

  const agents = nonRoot.filter((n) => n.kind === 'agent')
  const tools = nonRoot.filter((n) => n.kind === 'tool')
  const files = nonRoot.filter((n) => n.kind === 'file' || n.kind === 'folder')
  const tiles = nonRoot.filter((n) => n.kind === 'tile')
  const placed = new Map<string, HermesLeadPoint>()

  const pad = 24
  const midX = width / 2
  const topBandTop = 96
  const topBandBottom = Math.max(170, height * 0.42)
  const bottomBandTop = Math.min(height * 0.48, topBandBottom + 36)
  const bottomBandBottom = height - pad

  const agentBounds = { x0: pad, y0: topBandTop, x1: midX - 32, y1: topBandBottom }
  const toolBounds = { x0: midX + 32, y0: topBandTop, x1: width - pad, y1: topBandBottom }
  const fileBounds = { x0: pad, y0: bottomBandTop, x1: midX - 24, y1: bottomBandBottom }
  const tileBounds = { x0: midX + 24, y0: bottomBandTop, x1: width - pad, y1: bottomBandBottom }

  for (const p of relaxPointsInBounds(packInBox(agents, agentBounds), agentBounds, relaxIterations)) placed.set(p.id, p)
  for (const p of relaxPointsInBounds(packInBox(tools, toolBounds), toolBounds, relaxIterations)) placed.set(p.id, p)
  for (const p of relaxPointsInBounds(packInBox(files, fileBounds), fileBounds, relaxIterations)) placed.set(p.id, p)
  for (const p of relaxPointsInBounds(packInBox(tiles, tileBounds), tileBounds, relaxIterations)) placed.set(p.id, p)

  const leftovers = nonRoot.filter((n) => !placed.has(n.id))
  const fallbackBounds = { x0: width * 0.32, y0: height * 0.3, x1: width * 0.68, y1: height - 32 }
  for (const p of relaxPointsInBounds(packInBox(leftovers, fallbackBounds), fallbackBounds, relaxIterations)) {
    placed.set(p.id, p)
  }

  const out: HermesLeadPoint[] = []
  if (root) out.push({ id: root.id, x: width / 2, y: 44 })
  for (const n of nonRoot) {
    const p = placed.get(n.id)
    if (p) out.push(p)
  }

  if (interFamilyRelaxIterations > 0) {
    const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const))
    const relaxedNonRoot = relaxInterFamily(
      out.filter((p) => p.id !== root?.id),
      kindById,
      { x0: 20, y0: 92, x1: width - 20, y1: height - 20 },
      interFamilyRelaxIterations,
      interFamilyRelaxStrength
    )
    return root ? [{ id: root.id, x: width / 2, y: 44 }, ...relaxedNonRoot] : relaxedNonRoot
  }

  const compacted = out
    .filter((p) => p.id !== root?.id)
    .map((p) => ({
      ...p,
      x: clamp(width / 2 + (p.x - width / 2) * 0.97, 20, width - 20),
      y: clamp(height * 0.55 + (p.y - height * 0.55) * 0.97, 92, height - 20),
    }))
  return root ? [{ id: root.id, x: width / 2, y: 44 }, ...compacted] : compacted
}

export function computeHermesLeadClusterLayout(
  nodes: HermesLeadNode[],
  opts: HermesLeadLayoutOptions
): HermesLeadPoint[] {
  const width = Math.max(400, opts.width)
  const height = Math.max(320, opts.height)
  const mode = opts.mode ?? 'semantic'
  const packThreshold = Math.max(20, opts.packThreshold ?? 46)
  const resolvedMode = mode === 'auto' ? (nodes.length >= packThreshold ? 'pack' : 'semantic') : mode

  return resolvedMode === 'pack'
    ? computePackLayout(
        nodes,
        width,
        height,
        Math.max(0, opts.relaxIterations ?? 6),
        Math.max(0, opts.interFamilyRelaxIterations ?? 0),
        clamp(opts.interFamilyRelaxStrength ?? 1, 0.25, 2.5)
      )
    : computeSemanticLayout(nodes, width, height)
}
