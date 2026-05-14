/**
 * Fallback when the router omits `intent` — aligns with Sora-style triggers
 * (research, compare, investigate, …) from hotAsianIntern routing.
 */
export function heuristicResearchIntent(text: string): boolean {
  const t = text.toLowerCase()
  if (t.length < 6) return false
  const patterns = [
    /\bresearch\b/,
    /\bcompare\b/,
    /\bcompetitive\b/,
    /\bcompetitor\b/,
    /\banalyze\b/,
    /\binvestigate\b/,
    /\bsummarize\b/,
    /\bmarket research\b/,
    /\bmarket size\b/,
    /\btam\b|\bsam\b|\bsom\b/,
    /\bliterature\b/,
    /\bsurvey\b/,
    /\bevaluate\b/,
    /\blook into\b/,
    /\bpros and cons\b/,
    /\bwhat are the best\b/,
    /\bwhich \w+ (is|are) better\b/,
    /\bsources?\b/,
    /\bcite\b/,
    /\bwhitepaper\b/,
    /\bcase stud(y|ies)\b/,
  ]
  return patterns.some((re) => re.test(t))
}
