/**
 * Fast heuristic (no LLM): user is asking about Orca native Telegram or the companion gateway.
 * Used to auto-spawn telegram_onboard + native_gateway tiles.
 */
export function heuristicTelegramGatewayTilesIntent(prompt: string): boolean {
  const t = prompt.trim()
  if (!t) return false

  if (
    /\b(native\s+telegram|telegram\s+gateway|orca\s+telegram|connect\s+your\s+telegram|connect\s+telegram)\b/i.test(
      t
    )
  ) {
    return true
  }

  const mentionsTelegram =
    /\btelegram\b|t\.me\b|botfather|bot\s+token|@botfather/i.test(t) ||
    /@[\w_]+bot\b/i.test(t)

  if (mentionsTelegram) {
    if (
      /\b(connect|setup|integrate|link|enable|start|configure|onboard|bridge|gateway|how\s+do\s+i|dm|message\s+the\s+bot)\b/i.test(
        t
      )
    ) {
      return true
    }
  }

  // "Orca" / "canvas" appear in generic product copy and caused false positives (e.g. "gateway bug"
  // in battle-test docs). Real Telegram / companion help still matches via telegram|native|3001|…
  if (/\bgateway\b/i.test(t)) {
    if (
      /\b(telegram|native|companion|3001|bridge|websocket|ws|uiClients|bot)\b/i.test(t)
    ) {
      return true
    }
  }

  return false
}
