function isSuppressedEventType(eventType: string): boolean {
  return eventType === 'response.created' || eventType.startsWith('response.output')
}

const activeHermesFunctionCalls = new Map<string, { startedAt: number; summary: string | null }>()

function formatElapsedSeconds(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  return `${(safeMs / 1000).toFixed(1)}s`
}

function parseArgsRecord(argsRaw: unknown): Record<string, unknown> | null {
  if (typeof argsRaw !== 'string' || !argsRaw.trim()) return null
  try {
    const parsed = JSON.parse(argsRaw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function clampInline(text: string, max = 88): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) * 0.62)
  const tail = Math.floor((max - 1) * 0.38)
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

function summarizeFunctionCallArguments(argsRaw: unknown): string | null {
  const parsed = parseArgsRecord(argsRaw)
  if (!parsed) return null

  const path = typeof parsed.path === 'string' ? parsed.path.trim() : ''
  if (path) return `path=${clampInline(path)}`

  const cmd = typeof parsed.command === 'string' ? parsed.command.trim() : ''
  if (cmd) return `$ ${cmd.length > 88 ? `${cmd.slice(0, 87)}…` : cmd}`

  const pattern = typeof parsed.pattern === 'string' ? parsed.pattern.trim() : ''
  const target = typeof parsed.target === 'string' ? parsed.target.trim() : ''
  if (pattern) {
    const shortPattern = pattern.length > 56 ? `${pattern.slice(0, 55)}…` : pattern
    return target ? `target=${target} pattern=${shortPattern}` : `pattern=${shortPattern}`
  }

  const todos = Array.isArray(parsed.todos) ? parsed.todos : []
  if (todos.length > 0) {
    const action = typeof parsed.action === 'string' ? parsed.action.trim() : 'update'
    return `${action} ${todos.length} task(s)`
  }

  return null
}

export function formatWorkspaceTraceLine(workspaceRoot: string | null): string {
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''
  return root ? `┊ workspace ${root}` : '┊ workspace (no workspace)'
}

function summarizeHermesLeadSpecialTrace(name: string, argsRaw: unknown): string | null {
  const parsed = parseArgsRecord(argsRaw)
  if (name === 'skill_view') {
    const skillName = typeof parsed?.name === 'string' ? parsed.name.trim() : ''
    return `┊ skill     ${skillName || 'unknown'}`
  }
  if (name === 'plan' || name === 'todo') {
    const todos = Array.isArray(parsed?.todos) ? parsed.todos : []
    if (todos.length > 0) return `┊ plan      ${todos.length} task(s)`
    return '┊ plan      update'
  }
  return null
}

export function summarizeHermesProviderNoticeLine(line: string): string | null {
  const t = line.trim()
  if (!t) return null

  if (t.startsWith('[Hermes trace]')) {
    const rest = t.slice('[Hermes trace]'.length).trim()
    if (!rest || isSuppressedEventType(rest)) return null
    return `◆ ${rest}`
  }

  if (t.startsWith('event:')) {
    const eventType = t.slice('event:'.length).trim()
    if (!eventType || isSuppressedEventType(eventType)) return null
    return `◆ ${eventType}`
  }

  if (!t.startsWith('data:')) return null

  const payload = t.slice('data:'.length).trim()
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload) as {
      type?: unknown
      item?: { type?: unknown; name?: unknown; arguments?: unknown; call_id?: unknown }
    }
    const type = typeof parsed.type === 'string' ? parsed.type : null
    const itemType = typeof parsed.item?.type === 'string' ? parsed.item.type : null
    const itemName = typeof parsed.item?.name === 'string' ? parsed.item.name : null
    const callId = typeof parsed.item?.call_id === 'string' ? parsed.item.call_id : null

    if (type === 'response.output_item.added' && itemType === 'function_call' && itemName) {
      const special = summarizeHermesLeadSpecialTrace(itemName, parsed.item?.arguments)
      if (callId) activeHermesFunctionCalls.set(callId, { startedAt: Date.now(), summary: special })
      if (special) return special
      const detail = summarizeFunctionCallArguments(parsed.item?.arguments)
      return detail ? `→ ${itemName} ${detail}` : `→ ${itemName}`
    }
    if (type === 'response.output_item.done' && itemType === 'function_call' && itemName) {
      if (callId) {
        const active = activeHermesFunctionCalls.get(callId)
        if (active) {
          activeHermesFunctionCalls.delete(callId)
          const elapsed = formatElapsedSeconds(Date.now() - active.startedAt)
          if (active.summary) return `${active.summary}  ${elapsed}`
          return `← ${itemName} ${elapsed}`
        }
      }
      return `← ${itemName}`
    }

    return null
  } catch {
    return null
  }
}
