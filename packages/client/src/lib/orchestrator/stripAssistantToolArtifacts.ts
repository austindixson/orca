/**
 * Some models append pseudo–tool-call markup to assistant *text* (e.g. `<tool_call>canvas_list_modules/invoke`)
 * even when the chat API does not expose structured `tool_calls`. Strip that before showing or persisting prose.
 *
 * Also strips common **reasoning / chain-of-thought leaks** (thinking tags, fullwidth bracketed steps,
 * markdown-bold “Step N:” lines) that providers sometimes merge into `content`.
 */
export function stripAssistantToolArtifacts(text: string): string {
  if (!text) return text
  let s = text

  // --- Reasoning / CoT artifacts (paired blocks first) ---
  s = s.replace(/<\s*think(?:ing)?\b[^>]*>[\s\S]*?<\/\s*think(?:ing)?\s*>/gi, '')
  s = s.replace(/<\s*reasoning\b[^>]*>[\s\S]*?<\/\s*reasoning\s*>/gi, '')
  s = s.replace(/<\s*redacted_reasoning\b[^>]*>[\s\S]*?<\/\s*redacted_reasoning\s*>/gi, '')
  s = s.replace(/<\s*redacted_thinking\b[^>]*>[\s\S]*?<\/\s*redacted_thinking\s*>/gi, '')
  // Malformed leak: two closing-style segments (`</redacted_thinking>Step 1…</redacted_thinking>`)
  s = s.replace(/<\/\s*redacted_thinking\s*>[\s\S]*?<\/\s*redacted_thinking\s*>/gi, '')
  // Same pattern with bare `think` / `thinking` (some providers omit the `redacted_` prefix in leaks)
  s = s.replace(/<\/\s*think(?:ing)?\s*>[\s\S]*?<\/\s*think(?:ing)?\s*>/gi, '')
  // Mixed leaks: `</think>…</redacted_thinking>` or `</thinking>…</redacted_thinking>`
  s = s.replace(/<\/\s*think(?:ing)?\s*>[\s\S]*?<\/\s*redacted_thinking\s*>/gi, '')

  // Fullwidth lenticular brackets: 【Step 1: …】 (common tokenizer / Qwen-style leak)
  s = s.replace(/\u3010\s*Step\s*\d+\s*:[^\u3011]*\u3011/gi, '')

  // Markdown-bold wrapped “Step N:” fragments (single-line)
  s = s.replace(/\*\*\s*Step\s*\d+\s*:[^\n]+\*\*/gi, '')

  // Paired XML-ish blocks (multiline), including namespaced tags like <minimax:tool_call>.
  s = s.replace(/<\s*(?:[\w-]+:)?tool_call\b[^>]*>[\s\S]*?<\/\s*(?:[\w-]+:)?tool_call\s*>/gi, '')
  s = s.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
  s = s.replace(/<function_calls\b[^>]*>[\s\S]*?<\/function_calls>/gi, '')
  // Bracket-style tool wrappers used by some providers.
  s = s.replace(/\[\s*TOOL_CALL\s*\][\s\S]*?\[\s*\/\s*TOOL_CALL\s*\]/gi, '')
  // GLM / Z.AI-style pseudo calls: <function=write_file>…</function> (parameters inside)
  s = s.replace(/<\s*function\s*=\s*[^\s>]+[^>]*>[\s\S]*?<\/\s*function\s*>/gi, '')
  // Stray parameter wrappers if the outer </function> was truncated
  s = s.replace(/<\s*parameter\s*=\s*[^>]+\s*>[\s\S]*?<\/\s*parameter\s*>/gi, '')

  // Unclosed or inline fragments: `<tool_call>name/invoke` (no `</tool_call>` on the same span)
  s = s.replace(/<\s*(?:[\w-]+:)?tool_call\b[^>]*>[^\n<]*/g, '')

  s = s.replace(/<\/\s*(?:[\w-]+:)?tool_call\s*>/gi, '')
  s = s.replace(/<\/invoke>/gi, '')
  s = s.replace(/\[\s*\/\s*TOOL_CALL\s*\]/gi, '')
  s = s.replace(/\[\s*TOOL_CALL\s*\]/gi, '')

  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trimEnd()
}
