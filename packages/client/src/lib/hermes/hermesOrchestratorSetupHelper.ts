/**
 * Orchestrator-facing Hermes setup helper: detect local `hermes` CLI (Tauri), optional gateway
 * reachability, and produce guidance when the Hermes tile is enabled without a working install.
 */

import { normalizeHermesApiBaseUrl, useSettingsStore } from '../../store/settingsStore'
import { probeHermesModels } from './hermesResponses'
import { probeHermesCli as probeHermesCliFromTauri, type HermesCliProbeResult } from '../tauri'

export type HermesSetupDiagnoseInput = {
  /** From `probeHermesCli()`; null when not in Tauri (web dev). */
  cli: HermesCliProbeResult | null
  hermesTileEnabled: boolean
  /** null = not probed (no base URL); true/false from GET /models */
  gatewayOk: boolean | null
  gatewayHint: string | null
}

const HERMES_REPO = 'https://github.com/NousResearch/hermes-agent'
const DOCS_BRIDGE = 'docs/CANVAS_AGENT_BRIDGE.md'

/**
 * Markdown for the orchestrator or settings UI — copy matches tool output from `diagnose_hermes_setup`.
 */
export function formatHermesSetupDiagnoseMarkdown(input: HermesSetupDiagnoseInput): string {
  const { cli, hermesTileEnabled, gatewayOk, gatewayHint } = input
  const lines: string[] = ['## Hermes setup diagnose', '']

  if (cli === null) {
    lines.push(
      '**CLI check:** Only available in the **desktop app** (Tauri). In web preview, Orca cannot run `hermes --version` on your machine.',
      ''
    )
  } else if (cli.installed && cli.versionLine) {
    lines.push(`**Hermes CLI:** installed — \`${cli.versionLine}\``, '')
    if (cli.stderrOrError) {
      lines.push(`_(stderr: ${cli.stderrOrError})_`, '')
    }
  } else if (cli.installed) {
    lines.push('**Hermes CLI:** reported installed but no version line parsed.', '')
    if (cli.stderrOrError) lines.push(`Detail: ${cli.stderrOrError}`, '')
  } else {
    lines.push(
      '**Hermes CLI:** **not detected** on PATH (`hermes --version` failed or binary missing).',
      ''
    )
    if (cli.stderrOrError) {
      lines.push(cli.stderrOrError, '')
    }
    lines.push(
      `**Install:** Clone or install Hermes from [NousResearch/hermes-agent](${HERMES_REPO}) and ensure the \`hermes\` binary is on your PATH (verify in a normal terminal).`,
      ''
    )
  }

  if (gatewayOk !== null) {
    lines.push(
      gatewayOk
        ? '**Gateway (saved base URL):** reachable (`GET /models` succeeded).'
        : `**Gateway (saved base URL):** not reachable — ${gatewayHint ?? 'check failed'}.`,
      ''
    )
  } else if (gatewayHint) {
    lines.push(`**Gateway:** ${gatewayHint}`, '')
  }

  if (hermesTileEnabled) {
    const cliMissing = cli !== null && !cli.installed
    if (cliMissing) {
      lines.push(
        '### Hermes agent tile is ON',
        '',
        'You enabled **Show Hermes agent tile** in Settings → Agent → Hermes, but the Hermes CLI was not found. That often causes confusing errors when the orchestrator or tiles try to run `hermes gateway`.',
        '',
        '**Choose one:**',
        '',
        `1. **Install Hermes** (see above), then start the API with \`API_SERVER_ENABLED=true hermes gateway\` and align **Settings → Integrations → Hermes API** if needed. See \`${DOCS_BRIDGE}\` for the bridge contract.`,
        '',
        '2. **Turn off the Hermes tile** if you only use Orca’s standard **Agent** tiles: open **Settings → Agent → Hermes** and disable **Show Hermes agent tile in add-tile menus**. The orchestrator will stop offering Hermes-specific tools until you turn it back on.',
        ''
      )
    } else if (cli !== null && cli.installed && gatewayOk === false) {
      lines.push(
        '### Gateway issues',
        '',
        'CLI is present but the configured API base is not responding. Start `hermes gateway` locally or fix the base URL / API key under **Settings → Integrations → Hermes API**.',
        ''
      )
    }
  } else {
    lines.push(
      '**Hermes agent tile:** off in Settings — Hermes-specific orchestrator tools are hidden. Enable only after the CLI and gateway work.',
      ''
    )
  }

  lines.push(
    '---',
    '_Tool: `diagnose_hermes_setup` — run again after installing Hermes or changing Settings._'
  )

  return lines.join('\n')
}

/**
 * Full diagnose (CLI + optional gateway probe). Safe to call from the orchestrator tool handler.
 */
export async function runHermesOrchestratorSetupDiagnose(
  signal?: AbortSignal
): Promise<string> {
  const { showHermesAgentTile, hermesApiBaseUrl, hermesApiKey } = useSettingsStore.getState()
  const cli = await probeHermesCliFromTauri()

  let gatewayOk: boolean | null = null
  let gatewayHint: string | null = null
  const baseRaw = typeof hermesApiBaseUrl === 'string' ? hermesApiBaseUrl.trim() : ''
  if (baseRaw) {
    try {
      const normalized = normalizeHermesApiBaseUrl(baseRaw)
      const key = typeof hermesApiKey === 'string' && hermesApiKey.trim() ? hermesApiKey : undefined
      const r = await probeHermesModels(
        normalized || 'http://127.0.0.1:8642/v1',
        key,
        signal
      )
      gatewayOk = r.ok
      gatewayHint = r.hint || r.detail || null
    } catch (e) {
      gatewayOk = false
      gatewayHint = e instanceof Error ? e.message : String(e)
    }
  }

  return formatHermesSetupDiagnoseMarkdown({
    cli,
    hermesTileEnabled: showHermesAgentTile,
    gatewayOk,
    gatewayHint,
  })
}

export type { HermesCliProbeResult }
