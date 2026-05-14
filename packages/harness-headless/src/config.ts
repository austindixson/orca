import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface HarnessConfig {
  baseUrl: string
  bridgeToken: string
  openAiBaseUrl: string
  openAiApiKey: string
  model: string
}

function readTomlValue(raw: string, section: string, key: string): string | undefined {
  const lines = raw.split(/\r?\n/)
  let inSection = false
  for (const line of lines) {
    const s = line.trim()
    if (s.startsWith('[') && s.endsWith(']')) {
      inSection = s === `[${section}]`
      continue
    }
    if (!inSection) continue
    const m = line.match(new RegExp(`^${key}\\s*=\\s*["']?([^"']+)["']?\\s*$`))
    if (m) return m[1]?.trim()
    const m2 = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`))
    if (m2) return m2[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

export function loadConfig(): HarnessConfig {
  const port = process.env.PORT ?? process.env.ORCA_BRIDGE_PORT ?? '3001'
  const baseUrl = `http://127.0.0.1:${port}`
  let bridgeToken = process.env.CANVAS_BRIDGE_TOKEN?.trim() ?? ''

  const cfgPath = path.join(os.homedir(), '.orca', 'config.toml')
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf8')
      const t = readTomlValue(raw, 'bridge', 'token')
      if (t) bridgeToken = t
    } catch {
      /* ignore */
    }
  }

  let openAiApiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    ''
  let openAiBaseUrl =
    process.env.OPENAI_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'
  let model = process.env.ORCA_MODEL?.trim() || 'openai/gpt-4o-mini'

  if (fs.existsSync(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf8')
      const k = readTomlValue(raw, 'llm', 'api_key')
      const u = readTomlValue(raw, 'llm', 'base_url')
      const m = readTomlValue(raw, 'llm', 'model')
      if (k) openAiApiKey = k
      if (u) openAiBaseUrl = u
      if (m) model = m
    } catch {
      /* ignore */
    }
  }

  return {
    baseUrl,
    bridgeToken,
    openAiBaseUrl,
    openAiApiKey,
    model,
  }
}
