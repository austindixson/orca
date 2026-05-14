/**
 * MemPalace + Obsidian-style vault graph: scan markdown files, resolve [[wikilinks]]
 * and markdown links into a note graph for the sidebar brain visualizer.
 */

import * as tauri from '../tauri'

export interface BrainNode {
  id: string
  /** Workspace-relative path, e.g. notes/Foo.md */
  path: string
  label: string
  /** Top-level folder (or "(root)") — MemPalace "room" for coloring */
  room: string
  /** Backlink count (computed after edges) */
  degree: number
}

export interface BrainEdge {
  from: string
  to: string
  kind: 'wiki' | 'md_href' | 'embed'
}

export interface BrainGraph {
  nodes: BrainNode[]
  edges: BrainEdge[]
}

/** Wikilinks only (not embeds `![[...]]`). */
const WIKI = /(?<!\!)\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g
const WIKI_EMBED = /!\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g
// [text](url) — capture path-ish segment ending in .md
const MD_LINK = /\[([^\]]*)\]\(([^)]+\.md[^)]*)\)/gi

function norm(s: string): string {
  return s.trim().replace(/\\/g, '/')
}

function basename(path: string): string {
  const n = norm(path)
  const i = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'))
  return i >= 0 ? n.slice(i + 1) : n
}

function stripMd(name: string): string {
  return name.replace(/\.md$/i, '')
}

/** First path segment for "palace room" coloring. */
export function roomForPath(relativePath: string): string {
  const n = norm(relativePath)
  const i = n.indexOf('/')
  if (i <= 0) return '(root)'
  return n.slice(0, i)
}

/**
 * BFS the workspace tree via `read_directory` and collect all `.md` paths (workspace-relative).
 */
export async function listAllMarkdownPaths(): Promise<string[]> {
  const out: string[] = []
  const queue: string[] = ['.']
  const seen = new Set<string>()

  while (queue.length) {
    const dir = queue.shift()!
    if (seen.has(dir)) continue
    seen.add(dir)

    let entries
    try {
      entries = await tauri.readDirectory(dir)
    } catch {
      continue
    }

    for (const e of entries) {
      const rel = norm(e.path)
      if (e.is_directory) {
        queue.push(rel)
      } else if (e.name.toLowerCase().endsWith('.md')) {
        out.push(rel)
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b))
}

function extractWikiTargets(content: string): { wiki: string[]; embeds: string[] } {
  const wiki: string[] = []
  const embeds: string[] = []

  for (const m of content.matchAll(WIKI)) {
    const t = m[1]?.trim()
    if (t) wiki.push(t)
  }
  for (const m of content.matchAll(WIKI_EMBED)) {
    const t = m[1]?.trim()
    if (t) embeds.push(t)
  }
  return { wiki, embeds }
}

function extractMdHrefTargets(content: string, currentDir: string): string[] {
  const out: string[] = []
  const re = new RegExp(MD_LINK.source, 'gi')
  for (const m of content.matchAll(re)) {
    let href = (m[2] ?? '').trim()
    if (!href.toLowerCase().includes('.md')) continue
    href = href.split(/[?#]/)[0] ?? href
    if (href.startsWith('/')) continue
    const resolved = resolveRelativeMd(currentDir, href)
    if (resolved) out.push(resolved)
  }
  return out
}

function dirnamePath(path: string): string {
  const n = norm(path)
  const i = n.lastIndexOf('/')
  return i <= 0 ? '.' : n.slice(0, i)
}

function resolveRelativeMd(currentDir: string, href: string): string | null {
  const h = norm(href).replace(/^\.\//, '')
  if (!h.toLowerCase().endsWith('.md')) return null
  if (href.startsWith('/')) return null
  const combined =
    currentDir === '.' || currentDir === '' ? h : `${currentDir}/${h}`
  const parts = norm(combined).split('/')
  const stack: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      stack.pop()
    } else {
      stack.push(p)
    }
  }
  const out = stack.join('/')
  return out || null
}

/** Map: lowercase slug (no .md) -> workspace-relative path */
function buildSlugIndex(mdPaths: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of mdPaths) {
    const slug = stripMd(basename(p)).toLowerCase()
    if (!map.has(slug)) map.set(slug, p)
  }
  return map
}

function resolveWikiTarget(raw: string, slugIndex: Map<string, string>): string | null {
  const t = norm(raw).replace(/\.md$/i, '')
  const slug = stripMd(basename(t)).toLowerCase()
  return slugIndex.get(slug) ?? null
}

const MAX_FILE_BYTES = 512 * 1024

/**
 * Build a note graph from the current workspace (all markdown files).
 */
export async function buildObsidianBrainGraph(): Promise<BrainGraph> {
  const mdPaths = await listAllMarkdownPaths()
  const slugIndex = buildSlugIndex(mdPaths)
  const pathSet = new Set(mdPaths)

  const edges: BrainEdge[] = []
  const edgeSeen = new Set<string>()

  const pushEdge = (from: string, to: string, kind: BrainEdge['kind']) => {
    if (from === to) return
    const k = `${from}|${to}|${kind}`
    if (edgeSeen.has(k)) return
    edgeSeen.add(k)
    edges.push({ from, to, kind })
  }

  for (const path of mdPaths) {
    let content: string
    try {
      content = await tauri.readFile(path)
    } catch {
      continue
    }
    if (content.length > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES)
    }

    const currentDir = dirnamePath(path)

    const { wiki, embeds } = extractWikiTargets(content)
    for (const w of wiki) {
      const target = resolveWikiTarget(w, slugIndex)
      if (target) pushEdge(path, target, 'wiki')
    }
    for (const w of embeds) {
      const target = resolveWikiTarget(w, slugIndex)
      if (target) pushEdge(path, target, 'embed')
    }

    for (const href of extractMdHrefTargets(content, currentDir)) {
      if (pathSet.has(href)) pushEdge(path, href, 'md_href')
    }
  }

  const degree = new Map<string, number>()
  for (const p of mdPaths) degree.set(p, 0)
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const nodes: BrainNode[] = mdPaths.map((path) => ({
    id: path,
    path,
    label: stripMd(basename(path)),
    room: roomForPath(path),
    degree: degree.get(path) ?? 0,
  }))

  return { nodes, edges }
}

/** Prefer `wiki/index.md`, then root `README.md`, then highest-degree hub, else first path. */
export function pickBrainRootPath(graph: BrainGraph): string | null {
  if (graph.nodes.length === 0) return null
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  for (const node of graph.nodes) {
    if (norm(node.path) === 'wiki/index.md') return node.path
  }
  for (const node of graph.nodes) {
    const p = norm(node.path)
    if (p === 'readme.md' || p.endsWith('/readme.md')) {
      const d = dirnamePath(node.path)
      if (d === '.' || d === '') return node.path
    }
  }
  let best = graph.nodes[0]!
  for (const node of graph.nodes) {
    if (node.degree > best.degree) best = node
  }
  return best.path
}

export interface NodePosition {
  x: number
  y: number
}

/**
 * Lightweight force layout (Fruchterman-Reingold-ish) for small/medium graphs.
 * When `rootId` is set, that node stays pinned at the center so the brain opens focused on the vault entry.
 */
export function layoutBrainGraph(
  graph: BrainGraph,
  width: number,
  height: number,
  iterations = 60,
  rootId?: string | null
): Map<string, NodePosition> {
  const { nodes, edges } = graph
  const n = nodes.length
  const pos = new Map<string, NodePosition>()
  if (n === 0) return pos

  const cx = width / 2
  const cy = height / 2
  const area = width * height
  const k = Math.sqrt(area / Math.max(n, 1))

  for (const node of nodes) {
    if (rootId && node.id === rootId) {
      pos.set(node.id, { x: cx, y: cy })
      continue
    }
    const angle = Math.random() * Math.PI * 2
    const r = Math.min(width, height) * 0.15 + Math.random() * 20
    pos.set(node.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }

  const repulse = 0.45
  const attract = 0.035

  for (let it = 0; it < iterations; it++) {
    const disp = new Map<string, { dx: number; dy: number }>()
    for (const node of nodes) {
      disp.set(node.id, { dx: 0, dy: 0 })
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const pa = pos.get(a.id)!
        const pb = pos.get(b.id)!
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = (k * k) / dist
        const fx = (dx / dist) * force * repulse
        const fy = (dy / dist) * force * repulse
        const da = disp.get(a.id)!
        const db = disp.get(b.id)!
        da.dx += fx
        da.dy += fy
        db.dx -= fx
        db.dy -= fy
      }
    }

    for (const e of edges) {
      const pa = pos.get(e.from)
      const pb = pos.get(e.to)
      if (!pa || !pb) continue
      let dx = pb.x - pa.x
      let dy = pb.y - pa.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const force = (dist * dist) / k * attract
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      const da = disp.get(e.from)!
      const db = disp.get(e.to)!
      da.dx += fx
      da.dy += fy
      db.dx -= fx
      db.dy -= fy
    }

    const temp = 1 - it / iterations
    const maxStep = 12 * temp + 2
    for (const node of nodes) {
      const d = disp.get(node.id)!
      const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy) || 1
      const step = Math.min(maxStep, mag)
      const p = pos.get(node.id)!
      p.x += (d.dx / mag) * step
      p.y += (d.dy / mag) * step
      p.x = Math.max(16, Math.min(width - 16, p.x))
      p.y = Math.max(16, Math.min(height - 16, p.y))
    }

    if (rootId) {
      const pr = pos.get(rootId)
      if (pr) {
        pr.x = cx
        pr.y = cy
      }
    }
  }

  return pos
}

export function roomHue(room: string): string {
  let h = 0
  for (let i = 0; i < room.length; i++) {
    h = (h * 31 + room.charCodeAt(i)) % 360
  }
  return `hsl(${h} 55% 52%)`
}
