/**
 * Shared heuristics for terminal PTY output (Hermes gateway, npm, Rust, etc.).
 * Used by TerminalTile and tests.
 */

/**
 * Strip ANSI / OSC / DEC private sequences for telemetry and heuristics.
 * (OSC includes bracketed-paste / iTerm markers; DEC private includes `\x1b[?2004h` etc.)
 */
export function stripAnsiForTelemetry(s: string): string {
  let t = s
  /** Bracketed paste begin/end (ESC [ 200 ~ / 201 ~) — not matched by CSI+letter rule. */
  t = t.replace(/\x1b\[[0-9;]*~/g, '')
  t = t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  t = t.replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
  t = t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  return t
}

/** @deprecated Prefer {@link stripAnsiForTelemetry} — kept as alias for call sites. */
export function stripAnsi(s: string): string {
  return stripAnsiForTelemetry(s)
}

/**
 * Lines that look like non-fatal warnings (Hermes prints `WARNING gateway...`, npm `WARN`, Rust `warning:`).
 */
const LINE_WARNING_RES: RegExp[] = [
  /^\s*warning[\s:]/im, // Hermes: "WARNING gateway", rustc: "warning:"
  /\bwarning:\s/i,
  /\bnpm\s+WARN\b/i,
  /\bWARN\b/,
  /\bdeprecated\b/i,
  /\bunused\b/i,
  /\bexperimental\b/i,
  /\bgateway\.(run|platforms)\b/i,
  /\bapi_server\b/i,
  /\ballowlist/i,
  /\bapi key configured\b/i,
  /\bwithout authentication\b/i,
]

/**
 * True if any line in the chunk looks like a warning (not necessarily an error).
 */
export function chunkLooksLikeWarning(chunk: string): boolean {
  const text = stripAnsi(chunk).replace(/\r/g, '')
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (LINE_WARNING_RES.some((re) => re.test(line))) return true
  }
  return false
}

export type HermesGatewayWarningKind = 'allowlist' | 'api_key' | 'unknown'

/** First-line summary for activity feed / diagnostics store. */
export function summarizeHermesGatewayWarnings(chunk: string): {
  lines: string[]
  kinds: HermesGatewayWarningKind[]
  remediation: string
  /** Hermes printed the usual “no API key / unauthenticated” notice — Orca should not invent a key for localhost. */
  localDevNoApiKey: boolean
} | null {
  const text = stripAnsi(chunk).replace(/\r/g, '')
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\bwarning\b/i.test(l) || /\bgateway\.(run|platforms)/i.test(l))
  if (lines.length === 0) return null

  const kinds: HermesGatewayWarningKind[] = []
  const joined = lines.join('\n').toLowerCase()
  if (/allowlist|gateway_allow_all|unauthorized users/i.test(joined)) kinds.push('allowlist')
  if (/api[_ ]?server[_ ]?key|api key configured|\bapi key\b|without authentication/i.test(joined)) {
    kinds.push('api_key')
  }
  if (kinds.length === 0) kinds.push('unknown')

  /** Std Hermes gateway stderr when API_SERVER_KEY is unset — intentional open local API. */
  const localDevNoApiKey =
    kinds.includes('api_key') &&
    /no api key configured|accepted without authentication|without authentication|api key configured/i.test(joined)

  const parts: string[] = []
  if (kinds.includes('allowlist')) {
    parts.push(
      'Hermes gateway: no messenger allowlists — DMs may be denied. For local dev only, set GATEWAY_ALLOW_ALL_USERS=true in ~/.hermes/.env (see Hermes docs for production).'
    )
  }
  if (kinds.includes('api_key')) {
    if (localDevNoApiKey) {
      parts.push(
        'Hermes API server: no API_SERVER_KEY (solo local dev). Leave Orca Hermes API key empty. If Orca still has an old key, call configure_hermes_api with api_key "". Do not generate a random key. Then ensure a hermes_agent tile exists.'
      )
    } else {
      parts.push(
        'Hermes API server: review API_SERVER_KEY. For production set API_SERVER_KEY in Hermes and the same value via configure_hermes_api / Settings → Hermes API key.'
      )
    }
  }
  const remediation = parts.join(' ')

  return { lines: lines.slice(0, 6), kinds, remediation, localDevNoApiKey }
}
