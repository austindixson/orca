import type { TileType } from '../../store/canvasStore'

export interface GraphNodeDatum {
  id: string
  tileType: TileType
  title: string
  nodeScale: number
}

const TYPE_COLORS: Partial<Record<TileType, string>> = {
  orchestrator: '#2dd4bf',
  agent: '#8b5cf6',
  hermes_agent: '#f97316',
  terminal: '#38bdf8',
  editor: '#22c55e',
  browser: '#f59e0b',
  todo: '#f43f5e',
}

const TYPE_ICONS: Partial<Record<TileType, string>> = {
  orchestrator: 'O',
  agent: 'A',
  hermes_agent: 'H',
  terminal: 'T',
  editor: 'E',
  browser: 'B',
  todo: 'D',
}

function truncateLabel(label: string, max = 26): string {
  const clean = label.trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(1, max - 1))}…`
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(96, 165, 250, ${alpha})`
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function renderGraphNode(
  node: GraphNodeDatum,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  opts?: { hovered?: boolean; selected?: boolean; muted?: boolean }
) {
  const radius = 12 * node.nodeScale
  const color = TYPE_COLORS[node.tileType] ?? '#60a5fa'
  const icon = TYPE_ICONS[node.tileType] ?? node.tileType[0]?.toUpperCase() ?? '?'

  const x = (node as unknown as { x?: number }).x ?? 0
  const y = (node as unknown as { y?: number }).y ?? 0

  const alpha = opts?.muted ? 0.35 : 1

  if ((opts?.hovered || opts?.selected) && !opts?.muted) {
    ctx.beginPath()
    ctx.fillStyle = opts.selected ? 'rgba(45, 212, 191, 0.25)' : 'rgba(96, 165, 250, 0.2)'
    ctx.arc(x, y, radius * 1.9, 0, 2 * Math.PI, false)
    ctx.fill()
  }

  ctx.beginPath()
  ctx.fillStyle = opts?.muted ? hexToRgba(color, alpha) : color
  ctx.arc(x, y, radius, 0, 2 * Math.PI, false)
  ctx.fill()

  ctx.beginPath()
  ctx.lineWidth = opts?.selected ? 3 : 1.5
  ctx.strokeStyle = opts?.muted
    ? 'rgba(148, 163, 184, 0.28)'
    : opts?.selected
      ? '#99f6e4'
      : 'rgba(255, 255, 255, 0.38)'
  ctx.arc(x, y, radius, 0, 2 * Math.PI, false)
  ctx.stroke()

  ctx.fillStyle = opts?.muted ? 'rgba(148, 163, 184, 0.55)' : '#e5e7eb'
  ctx.font = `${Math.max(9, 9 * node.nodeScale / Math.max(globalScale, 0.8))}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(icon, x, y)

  const label = truncateLabel(node.title || node.id)
  ctx.fillStyle = opts?.muted ? 'rgba(148, 163, 184, 0.5)' : 'rgba(229, 231, 235, 0.92)'
  ctx.font = `${Math.max(8, 10 / Math.max(globalScale, 1))}px Inter, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText(label, x, y + radius + 6)
}
