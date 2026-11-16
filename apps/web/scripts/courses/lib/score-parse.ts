// Parsing the model's answer to a reference-view comparison. The model is asked
// for one JSON object, { "score": 1..5, "differences": ["..."] }, but it often
// wraps it in prose or a code fence, so this pulls the object out and checks it.
// Pure: tested in score-parse.test.ts. See docs/night-shift/jobs/views.md.
export type ViewScore = { score: number; differences: string[] }

/** A score clamped to the rubric's 1..5, or null when the text has none. */
export function clampScore(raw: unknown): number | null {
  const n = Math.round(Number(raw))
  if (!Number.isInteger(n) || n < 1 || n > 5) return null
  return n
}

/**
 * Read a score out of the model's reply. Tries a JSON object first (allowing a
 * surrounding code fence or a little prose), then falls back to the numbers it
 * can still see. Throws when there is no usable score, so a bad reply is never
 * silently written as a 3.
 */
export function parseScoreAnswer(text: string): ViewScore {
  const t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1] : t
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
      const score = clampScore(obj.score ?? obj.Score)
      if (score !== null) {
        const differences = Array.isArray(obj.differences)
          ? obj.differences.map((d) => String(d)).map((d) => d.trim()).filter(Boolean)
          : []
        return { score, differences }
      }
    } catch {
      // not clean JSON yet; fall through to the numbers below
    }
  }
  const m = candidate.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/i)
  const score = m ? clampScore(m[1]) : null
  if (score === null) throw new Error(`no 1-5 score in the answer: ${text.slice(0, 120)}`)
  const diff = candidate.match(/"differences"\s*:\s*\[([\s\S]*?)\]/i)
  const differences = diff
    ? diff[1]
        .split(',')
        .map((d) => d.replace(/^["']|["']$/g, '').trim())
        .filter(Boolean)
    : []
  return { score, differences }
}
