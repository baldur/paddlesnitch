// The paddlesnitch voice for paddle summaries (packages/analysis/src/voice.ts):
// the check that rejects AI-sounding or made-up drafts, and generateInsight's
// one retry before the plain summary stands.
import { describe, it, expect, vi } from 'vitest'
import { summaryProblems, EXAMPLES, voicePrompt, VOICE, tidyDraft, numbersNotInFacts } from '@paddlesnitch/analysis/voice'
import { generateInsight, buildPrompt, SYSTEM, RETRY_IF_FIRST_UNDER_MS } from '@paddlesnitch/analysis/llm'
import type { AnalysisResult } from '@paddlesnitch/analysis/analysis'

const FACTS = [
  'Session: 2 minutes 59 seconds, 0.48 km.',
  'Cruising pace ~2:45/500 at ~64 spm, ~2.9 m per stroke (distance per stroke — efficiency).',
  'Efforts (1):',
  '  1) at 1:53, 1:06, pace 2:31/500, 64 spm (2% variation), steady.',
  'Conditions: wind 11 km/h; river flow 48.2 m³/s (Reading).',
].join('\n')

describe('summaryProblems', () => {
  it('passes a plain note whose numbers are all in the facts', () => {
    expect(summaryProblems('One effort, 1:06 at 2:31/500 and 64 spm, with 2% variation in the stroke rate. Cruising pace was 2:45/500 into 11 km/h of wind.', FACTS)).toEqual([])
  })

  it('accepts a fact rounded ("0.5 km" for 0.48, "48" for 48.2), not a different number ("0.6 km")', () => {
    expect(summaryProblems('Flow was 48 m³/s over 0.5 km.', FACTS)).toEqual([])
    expect(summaryProblems('You covered 0.6 km.', FACTS)).toEqual(['it uses numbers that are not in the facts: 0.6'])
  })

  // What Qwen3 Next and Mixtral really wrote on 2026-11-01, before the voice.
  it.each([
    ['Great job on your first recorded kayak session!', /"great job"/],
    ['That rock-solid 64 spm was rare so early in your rowing journey.', /"rock-solid".*"journey"/],
    ['Your blade work is already finding rhythm in tough conditions.', /can't show: "blade"/],
    ['You held it even as fatigue crept in.', /can't show: "fatigue"/],
    ['The run per stroke felt smooth.', /can't show: "felt", "smooth"/],
    ['Keep up the good work, and you will see the gains.', /"keep up the"/],
  ])('rejects %j', (draft, problem) => {
    expect(summaryProblems(draft, FACTS).join('; ')).toMatch(problem)
  })

  it('rejects numbers the facts never gave (a "three-minute effort" from a 1:06 one)', () => {
    expect(summaryProblems('Your 3:00 effort at 2:31/500.', FACTS)).toEqual(['it uses numbers that are not in the facts: 3:00'])
    expect(summaryProblems('You held 70 spm.', FACTS)).toEqual(['it uses numbers that are not in the facts: 70'])
  })

  it('checks spelled-out counts too ("seven efforts" when there was one)', () => {
    expect(summaryProblems('Seven efforts at 2:31/500.', FACTS)).toEqual(['it uses numbers that are not in the facts: 7'])
    expect(summaryProblems('Two rests and one effort at 2:31/500.', FACTS)).toEqual([])
  })

  it('rejects exclamation marks, dashes as punctuation, questions, lists and long notes', () => {
    expect(summaryProblems('A steady paddle!', FACTS)).toEqual(['it has an exclamation mark'])
    expect(summaryProblems('A steady paddle — 64 spm.', FACTS)).toEqual(['it uses a dash as punctuation'])
    expect(summaryProblems('Ready for more?', FACTS)).toEqual(['it asks a question'])
    expect(summaryProblems('- 64 spm', FACTS)).toEqual(['it uses a list or heading'])
    expect(summaryProblems(Array(71).fill('steady').join(' '), FACTS)).toEqual(['it is longer than 70 words'])
  })

  it('allows a dash in a range of numbers ("2:46–2:49/500")', () => {
    expect(summaryProblems('Efforts at 2:31–2:45/500.', FACTS)).toEqual([])
  })

  it('matches whole words only ("catchment" and "feeling" differ from "catch"; "solidly" is not "solid")', () => {
    expect(summaryProblems('The river catchment was high.', FACTS)).toEqual([])
    expect(summaryProblems('A solidly steady paddle.', FACTS)).toEqual([])
  })
})

describe('tidyDraft', () => {
  it('turns a dash between words into a comma, and leaves a range of numbers', () => {
    expect(tidyDraft(' Cruising at 2:45/500 — 2.9 m per stroke. ')).toBe('Cruising at 2:45/500, 2.9 m per stroke.')
    expect(tidyDraft('Steady—64 spm.')).toBe('Steady, 64 spm.')
    expect(tidyDraft('Steady - 64 spm, a well-paced row.')).toBe('Steady, 64 spm, a well-paced row.')
    expect(tidyDraft('Efforts at 2:31–2:45/500.')).toBe('Efforts at 2:31–2:45/500.')
    expect(tidyDraft('Efforts at 2:31 - 2:45/500.')).toBe('Efforts at 2:31–2:45/500.')   // a spaced range stays a range
    expect(tidyDraft('Paces 2:31 — 2:45.')).toBe('Paces 2:31, 2:45.')                  // an em dash is punctuation
  })
})

describe('numbersNotInFacts', () => {
  it('lists each number the facts never gave, once', () => {
    expect(numbersNotInFacts('Hold 2:31/500 for 45 seconds, then 45 more and 300 m.', FACTS)).toEqual(['45', '300'])
  })
})

describe('the voice and its examples', () => {
  it.each(EXAMPLES.map((e, i) => [i + 1, e] as const))('example %i passes its own check', (_, e) => {
    expect(summaryProblems(e.summary, e.facts)).toEqual([])
  })

  // The examples' facts must look like what buildPrompt writes, or a model
  // copying them writes formats the check rejects (an hour as 1:02:40).
  it('examples use the fact formats real paddles get', () => {
    for (const e of EXAMPLES) {
      expect(e.facts).not.toMatch(/\d:\d{2}:\d{2}/)
      expect(e.facts).not.toMatch(/fading|—/)
      expect(e.facts).not.toMatch(/\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) /)
      for (const line of e.facts.split('\n').filter(l => l.startsWith('Rests:'))) expect(line).toMatch(/^Rests: \d+, .+ in total \(/)
    }
  })

  it('is the system prompt, examples included', () => {
    expect(SYSTEM).toBe(voicePrompt())
    expect(SYSTEM).toContain(VOICE)
    for (const e of EXAMPLES) expect(SYSTEM).toContain(e.summary)
  })

  it('tells the model it did not watch them paddle, and to use only numbers from the facts', () => {
    expect(VOICE).toMatch(/You did not watch them paddle/)
    expect(VOICE).toMatch(/Use only numbers exactly as they appear in the facts. Never add, subtract/)
  })
})

const result = (): AnalysisResult => ({
  points: [], stops: [], surges: [], sets: [], distanceKm: 4.2, durationS: 1800, cruiseSpeed: 3, avgSR: 58, avgDps: 3.1, srCv: 5,
  insight: 'plain summary',
} as unknown as AnalysisResult)

describe('generateInsight keeps to the voice', () => {
  it('returns a draft that passes', async () => {
    const run = vi.fn().mockResolvedValue('A steady 4.2 km at 58 spm.')
    expect(await generateInsight(result(), {}, run)).toBe('A steady 4.2 km at 58 spm.')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('sends a failing draft back once with what was wrong, and keeps the fixed one', async () => {
    const run = vi.fn().mockResolvedValueOnce('Impressive work today!').mockResolvedValueOnce('A steady 4.2 km at 58 spm.')
    expect(await generateInsight(result(), {}, run)).toBe('A steady 4.2 km at 58 spm.')
    const retry = run.mock.calls[1][1] as string
    expect(retry).toContain(buildPrompt(result()))
    expect(retry).toContain('Impressive work today!')
    expect(retry).toMatch(/"impressive".*exclamation mark/)
  })

  it('names the numbers to leave out when a draft invents some', async () => {
    const run = vi.fn().mockResolvedValueOnce('A steady 4.2 km; next time hold 61 spm for 300 m.').mockResolvedValueOnce('A steady 4.2 km at 58 spm.')
    expect(await generateInsight(result(), {}, run)).toBe('A steady 4.2 km at 58 spm.')
    expect(run.mock.calls[1][1]).toMatch(/Leave out 61, 300: do not replace them/)
  })

  it('keeps the plain summary when the retry repeats the invented number', async () => {
    const run = vi.fn().mockResolvedValueOnce('A steady 4.2 km at 61 spm.').mockResolvedValueOnce('A steady 4.2 km, again at 61 spm.')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await generateInsight(result(), {}, run)).toBeNull()
    warn.mockRestore()
  })

  it('skips the retry when the first draft was slow, so the request stays inside the server limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const run = vi.fn().mockImplementation(async () => { vi.setSystemTime(Date.now() + RETRY_IF_FIRST_UNDER_MS + 1); return 'Great job!' })
      expect(await generateInsight(result(), {}, run)).toBeNull()
      expect(run).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('a paddle without a map: a draft that invents a distance falls back', async () => {
    const motion = { ...result(), distanceKm: 0, cruiseSpeed: 0, noGps: { reason: { kind: 'gps_lost', lostAfterS: 30, recordedS: 1800 }, strokes: 1700 } } as unknown as AnalysisResult
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await generateInsight(motion, {}, vi.fn().mockResolvedValue('About 4.8 km at 58 spm.'))).toBeNull()
    warn.mockRestore()
  })

  it('fixes a dash used as punctuation without a retry', async () => {
    const run = vi.fn().mockResolvedValue('A steady 4.2 km — 58 spm throughout.')
    expect(await generateInsight(result(), {}, run)).toBe('A steady 4.2 km, 58 spm throughout.')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps the plain summary (null) when the second draft fails too', async () => {
    const run = vi.fn().mockResolvedValue('Great job!')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await generateInsight(result(), {}, run)).toBeNull()
    expect(run).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns null when the model gives nothing', async () => {
    expect(await generateInsight(result(), {}, vi.fn().mockResolvedValue(null))).toBeNull()
  })
})
