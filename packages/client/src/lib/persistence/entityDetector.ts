/**
 * Hermes-style lightweight entity mentions (stub tiers for future enrichment).
 */

export interface Entity {
  type: 'file' | 'person' | 'concept' | 'error'
  name: string
  mentions: number
  tier: 1 | 2 | 3
}

export function detectEntities(content: string): Entity[] {
  const counts = new Map<string, { type: Entity['type']; n: number }>()
  const bump = (name: string, type: Entity['type']) => {
    const k = `${type}:${name}`
    const cur = counts.get(k) ?? { type, n: 0 }
    cur.n += 1
    counts.set(k, cur)
  }

  for (const m of content.matchAll(/\b[\w./-]+\.(?:ts|tsx|js|jsx|rs|py|go|md|json)\b/g)) {
    bump(m[0]!, 'file')
  }
  for (const m of content.matchAll(/\b(Error|TypeError|ReferenceError):\s*([^\n]{1,120})/gi)) {
    bump(`${m[1]}: ${m[2]?.trim() ?? ''}`, 'error')
  }

  const out: Entity[] = []
  for (const [k, v] of counts) {
    const idx = k.indexOf(':')
    const name = idx >= 0 ? k.slice(idx + 1) : k
    const tier: 1 | 2 | 3 = v.n >= 8 ? 1 : v.n >= 3 ? 2 : 3
    out.push({
      type: v.type,
      name,
      mentions: v.n,
      tier,
    })
  }
  return out.sort((a, b) => b.mentions - a.mentions).slice(0, 50)
}
