// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from '../tests/helpers'
import { deterministicProfile, refreshAthleteProfile, PROFILE_SYSTEM } from '@paddlesnitch/analysis/athlete-profile'
import { getAthleteProfile, saveAthleteProfile, type SessionSummary, type AthleteProfile } from '@paddlesnitch/analysis/analysis-store'
import { profileProblems, impossibleTimes } from '@paddlesnitch/analysis/voice'
import { RETRY_IF_FIRST_UNDER_MS } from '@paddlesnitch/analysis/llm'

function paddle(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: Math.random().toString(36).slice(2), createdAt: '', paddledAt: '2026-07-01T08:00:00Z',
    source: { type: 'file' }, durationS: 1800, distanceKm: 5, avgSR: 60, cruiseSpeed: 500 / 150,
    effortCount: 0, avgDps: 3, note: '', insight: '', ...over,
  }
}

describe('deterministicProfile', () => {
  it('is empty below the cold-start threshold', () => {
    expect(deterministicProfile([paddle(), paddle()])).toBe('')
  })

  it('summarises count, boat classes and note-keeping from ≥3 paddles', () => {
    const p = deterministicProfile([
      paddle({ distanceKm: 5, boatClass: 'K1', note: 'felt good' }),
      paddle({ distanceKm: 7, boatClass: 'K1' }),
      paddle({ distanceKm: 6, boatClass: '2X', note: 'tired' }),
    ])
    expect(p).toContain('3 logged paddles')
    expect(p).toContain('K1')
    expect(p).toContain('2X')
    expect(p).toContain('diary')          // 2 paddles carried notes
  })

  it('passes the profile check itself, so a stored one is kept', () => {
    const p = deterministicProfile([paddle({ boatClass: 'K1', note: 'a' }), paddle(), paddle()])
    expect(profileProblems(p, p)).toEqual([])
  })
})

// The paddles' prompt has "5.0km", "2:30/500", "60spm" and "1 Jul 2026".
const FACTS = 'They have 4 saved paddles, 5.0 km on average.\n  - 1 Jul 2026: 5.0km, cruise 2:30/500, 60spm, K1.'

describe('profileProblems (#821)', () => {
  it('passes a plain profile whose numbers are all in the paddles given', () => {
    expect(profileProblems('Paddles a K1, usually 5 km at 2:30/500 and 60 spm. Has 4 saved paddles.', FACTS)).toEqual([])
  })

  it('rejects a time that cannot be ("2:60/500")', () => {
    expect(profileProblems('Cruises near 2:60/500.', `${FACTS} 2:60`)).toEqual([
      "it has times that can't be (a minute has 60 seconds): 2:60",
    ])
    expect(impossibleTimes('2:30/500 over 1:05:30, then 1:75:00')).toEqual(['1:75:00'])
  })

  it('rejects US spellings and names the British form', () => {
    expect(profileProblems('Paddles a K1, favoring the river centre over 5 km.', FACTS)).toEqual([
      'it uses US spellings: write "favouring", not "favoring"',
    ])
    expect(profileProblems('Paddles a K1 over 5 kilometers.', FACTS)[0]).toMatch(/"kilometres", not "kilometers"/)
  })

  it('rejects a number not in the paddles given, but allows rounding', () => {
    expect(profileProblems('Usually 5 km at 2:30/500.', FACTS)).toEqual([])
    expect(profileProblems('Usually 7.5 km at 2:41/500.', FACTS)).toEqual([
      'it uses numbers that are not in the paddles given: 7.5, 2:41',
    ])
  })

  it('rejects the summary voice\'s banned words and claims the numbers can\'t show', () => {
    const p = profileProblems('A dedicated paddler on a journey, with smooth technique!', FACTS)
    expect(p.join('\n')).toMatch(/"journey"/)
    expect(p.join('\n')).toMatch(/"technique", "smooth"/)
    expect(p).toContain('it has an exclamation mark')
  })

  it('rejects a profile over the length cap', () => {
    expect(profileProblems(Array(121).fill('paddle').join(' '), FACTS)).toEqual(['it is longer than 120 words'])
  })
})

describe('PROFILE_SYSTEM', () => {
  it('asks for the voice: British English, no praise, only what is given', () => {
    expect(PROFILE_SYSTEM).toMatch(/British English/)
    expect(PROFILE_SYSTEM).toMatch(/No praise words/)
    expect(PROFILE_SYSTEM).toMatch(/Use only what you are given/)
    expect(PROFILE_SYSTEM).not.toMatch(/coach|character/i)
  })
})

describe('refreshAthleteProfile', () => {
  const USER = 'user-profile'
  const NOW = '2026-07-20T12:00:00Z'
  const PREVIOUS: AthleteProfile = { text: 'Paddles a K1, usually 5 km.', updatedAt: '2026-07-10T12:00:00Z', builtFromCount: 3 }
  const four = () => [paddle({ boatClass: 'K1' }), paddle(), paddle(), paddle()]
  const GOOD = 'Paddles a K1, usually 5 km at 2:30/500 and 60 spm.'
  let dataDir: string
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(async () => { dataDir = await makeDataDir(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(async () => { warn.mockRestore(); await cleanDataDir(dataDir) })

  it('skips (returns null) during cold start: no storage or model touched', async () => {
    const two = [paddle(), paddle()]
    const run = vi.fn()
    expect(await refreshAthleteProfile(USER, two[0], two, NOW, run)).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('saves a good draft', async () => {
    const all = four()
    const run = vi.fn().mockResolvedValue(GOOD)
    expect((await refreshAthleteProfile(USER, all[0], all, NOW, run))?.text).toBe(GOOD)
    expect(await getAthleteProfile(USER)).toEqual({ text: GOOD, updatedAt: NOW, builtFromCount: 4 })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe(PROFILE_SYSTEM)
  })

  it.each([
    ['an impossible pace', 'Paddles a K1, usually 5 km at 2:60/500.'],
    ['a US spelling', 'Paddles a K1, favoring 5 km.'],
    ['an invented number', 'Paddles a K1, usually 12.5 km.'],
    ['a banned word', 'An impressive K1 paddler, usually 5 km.'],
  ])('rejects a draft with %s and keeps the previous profile', async (_, bad) => {
    await saveAthleteProfile(USER, PREVIOUS)
    const all = four()
    const run = vi.fn().mockResolvedValue(bad)
    expect(await refreshAthleteProfile(USER, all[0], all, NOW, run)).toEqual(PREVIOUS)
    expect(await getAthleteProfile(USER)).toEqual(PREVIOUS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('saves the deterministic profile when the draft fails and there is no previous one', async () => {
    const all = four()
    const run = vi.fn().mockResolvedValue('Paddles a K1 at 2:60/500.')
    const saved = await refreshAthleteProfile(USER, all[0], all, NOW, run)
    expect(saved?.text).toBe(deterministicProfile(all))
    expect((await getAthleteProfile(USER))?.text).toBe(deterministicProfile(all))
  })

  it('sends a failing draft back once, naming the problems, and saves a good second draft', async () => {
    await saveAthleteProfile(USER, PREVIOUS)
    const all = four()
    const run = vi.fn().mockResolvedValueOnce('Paddles a K1, favoring 12.5 km at 2:60/500.').mockResolvedValueOnce(GOOD)
    expect((await refreshAthleteProfile(USER, all[0], all, NOW, run))?.text).toBe(GOOD)
    const retry = run.mock.calls[1][1] as string
    expect(retry).toContain('Paddles a K1, favoring 12.5 km at 2:60/500.')
    expect(retry).toMatch(/"favouring", not "favoring"/)
    expect(retry).toMatch(/can't be.*2:60/)
    expect(retry).toMatch(/Leave out 12\.5, 2:60/)
    // A merge keeps the count of the last full build.
    expect(await getAthleteProfile(USER)).toEqual({ text: GOOD, updatedAt: NOW, builtFromCount: 3 })
  })

  it('does not retry when the first call was slow, and keeps the previous profile', async () => {
    await saveAthleteProfile(USER, PREVIOUS)
    const all = four()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const run = vi.fn().mockImplementation(async () => { vi.setSystemTime(Date.now() + RETRY_IF_FIRST_UNDER_MS + 1); return 'Paddles at 2:60/500.' })
      expect(await refreshAthleteProfile(USER, all[0], all, NOW, run)).toEqual(PREVIOUS)
      expect(run).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
    expect(await getAthleteProfile(USER)).toEqual(PREVIOUS)
  })

  it('rebuilds a stored profile that fails the check, and replaces it even if the rebuild fails', async () => {
    await saveAthleteProfile(USER, { text: 'Paddles a K1, favoring 2:60/500.', updatedAt: '2026-07-10T12:00:00Z', builtFromCount: 3 })
    const all = four()
    const run = vi.fn().mockResolvedValue(null)
    const saved = await refreshAthleteProfile(USER, all[0], all, NOW, run)
    expect(run.mock.calls[0][1]).toMatch(/^They have 4 saved paddles, 5\.0 km on average\./)   // a full build, not a merge
    expect(saved).toEqual({ text: deterministicProfile(all), updatedAt: NOW, builtFromCount: 4 })
  })

  it('keeps the previous profile when the model gives nothing', async () => {
    await saveAthleteProfile(USER, PREVIOUS)
    const all = four()
    expect(await refreshAthleteProfile(USER, all[0], all, NOW, vi.fn().mockResolvedValue(null))).toEqual(PREVIOUS)
  })
})
