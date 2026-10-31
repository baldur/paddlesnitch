// Paddles without a map (#414): a tracker recording whose GPS failed becomes a
// paddle from its motion data. It counts towards the paddle count, time on the
// water and streaks; it adds nothing to km; it is never offered for compare,
// sections or similar paddles; and nothing written about it mentions a
// distance or pace it doesn't have.
import { describe, it, expect } from 'vitest'
import {
  isMotionOnly, paddleKm, paddleTotals, weeklyKm, monthKm, weekStreak, groupSameOuting, paddlingSummary,
} from '@paddlesnitch/core/paddles'
import { motionOnlyResult, plainInsight, roundStrokes, MIN_MOTION_PADDLE_S, type AnalysisResult } from '@paddlesnitch/analysis/analysis'
import { buildPrompt } from '@paddlesnitch/analysis/llm'
import { historyBits, renderRelevant, paddleHighlights } from '@paddlesnitch/analysis/history-stats'
import { deterministicProfile } from '@paddlesnitch/analysis/athlete-profile'
import { shareCard } from '@paddlesnitch/analysis/share-card'
import { findSimilar, buildRace } from '@paddlesnitch/analysis/similar'
import { isSameOuting } from '@paddlesnitch/analysis/same-outing'
import { passesIn, sectionOf } from '@paddlesnitch/analysis/section-passes'
import type { AnalysisSession, SessionSummary } from '@paddlesnitch/analysis/analysis-store'
import type { StrokeRateSet } from '@paddlesnitch/timing/cadence'
import { recordingStart, type NoPaddleReason } from '@paddlesnitch/timing/device'

const NOW = new Date('2026-10-07T12:00:00Z')   // a Wednesday
const p = (at: string, km: number, durationS = 3600) => ({ paddledAt: at, distanceKm: km, durationS, source: { type: 'device' } })
// Even with a distance set by mistake, a paddle without a map adds no km.
const noMap = (at: string, durationS = 3600) => ({ ...p(at, 3, durationS), noGps: true as const })

describe('isMotionOnly and its own distance', () => {
  it('is the noGps marker on a result, a summary or a card, and nothing else', () => {
    expect(isMotionOnly({ noGps: { reason: { kind: 'no_gps', recordedS: 900 }, strokes: 600 } })).toBe(true)
    expect(isMotionOnly({ noGps: true })).toBe(true)
    expect(isMotionOnly({})).toBe(false)
    expect(isMotionOnly(null)).toBe(false)
  })

  it('shows "—" for its own distance, never "0 km"', () => {
    expect(paddleKm(noMap('2026-10-06T08:00:00Z'))).toBe('—')
    expect(paddleKm(p('2026-10-06T08:00:00Z', 4.257))).toBe('4.26 km')
    expect(paddleKm(p('2026-10-06T08:00:00Z', 4.257), 1)).toBe('4.3 km')
  })
})

describe('totals and the logbook', () => {
  const list = [p('2026-10-06T08:00:00Z', 4), noMap('2026-10-01T08:00:00Z', 1800), p('2026-09-24T08:00:00Z', 6)]

  it('counts the paddle and its time on the water, adds nothing to km', () => {
    expect(paddleTotals(list)).toEqual({ count: 3, totalKm: 10, totalS: 3600 + 1800 + 3600, since: '2026-09-24T08:00:00Z' })
  })

  it('adds nothing to the weekly km chart or the month', () => {
    expect(weeklyKm(list, NOW, 3).map(w => w.km)).toEqual([6, 0, 4])
    expect(monthKm(list, NOW)).toEqual({ thisMonth: 4, lastMonth: 6 })
  })

  it('keeps a streak going on its own', () => {
    // Last week's only paddle had no map: still three weeks in a row.
    expect(weekStreak(list, NOW)).toBe(3)
    expect(weekStreak([noMap('2026-10-06T08:00:00Z')], NOW)).toBe(1)
  })

  it("is never the year's longest paddle and adds nothing to this year's km", () => {
    const s = paddlingSummary([{ ...noMap('2026-10-01T08:00:00Z'), id: 'm', cruiseSpeed: 0 }], NOW)
    expect(s).toMatchObject({ count: 1, thisYearKm: 0, longest: null, fastest: null, streak: 1 })
  })

  it('stands alone in the list: not grouped with the same outing from Strava, so it is never offered to compare', () => {
    const strava = { ...p('2026-10-06T08:00:00Z', 8), source: { type: 'strava' } }
    const tracker = { ...noMap('2026-10-06T08:00:30Z'), source: { type: 'device' } }
    expect(groupSameOuting([strava, tracker]).map(g => [g.lead.source.type, g.others.length])).toEqual([['strava', 0], ['device', 0]])
  })
})

// --- the paddle itself ---
// What the recorder core says about a recording (recordingStrokeRate(...).all;
// its maths is tested in recorder-core/ and cadence.test.ts): `paddlingMin`
// with a clear stroke at 50 spm, and the rests between.
const strokes = (paddlingMin: number, rests: [number, number][] = []): StrokeRateSet => ({
  report: { available: true, code: 'ok', reason: '', sampleRateHz: 12.5, rows: 1, medianStrokesPerMin: 50, windows: [] },
  paddling: { paddlingS: paddlingMin * 60, strokes: paddlingMin * 50, strokesPerMin: 50 },
  rests,
})
// 0-12 min paddling, a 5 min rest, 17-29 min paddling.
const TWO_STRETCHES = strokes(24, [[12 * 60_000, 17 * 60_000]])
const START = Date.parse('2026-10-11T07:00:00Z')
const LOST: NoPaddleReason = { kind: 'gps_lost', lostAfterS: 30, recordedS: 1800 }

function motionPaddle(): AnalysisResult {
  // The tracker's millis() clock read 0 at 07:00:00 UTC.
  return motionOnlyResult({ reason: LOST, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: START, track: null })!
}

describe('a paddle from the motion data alone', () => {
  it('has paddling time, median stroke rate, strokes and rests, and no distance, speed or pace', () => {
    const r = motionPaddle()
    expect(r.durationS).toBe(24 * 60)
    expect(r.avgSR).toBe(50)
    expect(r.noGps).toEqual({ reason: LOST, strokes: 1200 })
    expect(r).toMatchObject({ distanceKm: 0, avgSpeed: 0, cruiseSpeed: 0, avgDps: null, points: [], surges: [], sets: [] })
    expect(r.stops).toEqual([expect.objectContaining({ kind: 'rest', fromT: 720, toT: 1020, durS: 300 })])
    expect(isMotionOnly(r)).toBe(true)
  })

  it('keeps the route from before the GPS was lost, if any', () => {
    const track = [0, 1, 2].map(s => ({ lat: 51.5 + s * 1e-5, lng: -0.9, timestamp: new Date(START + (s + 5) * 1000) }))
    const r = motionOnlyResult({ reason: LOST, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: START, track })!
    expect(r.points.map(q => [q.t, q.lat])).toEqual([[5, 51.5], [6, 51.50001], [7, 51.50002]])
  })

  it('needs 10 minutes of paddling', () => {
    expect(MIN_MOTION_PADDLE_S).toBe(600)
    expect(motionOnlyResult({ reason: LOST, strokes: strokes(9), startMs: START, clockOffsetMs: START })).toBeNull()
    expect(motionOnlyResult({ reason: LOST, strokes: strokes(10), startMs: START, clockOffsetMs: START })).not.toBeNull()
  })

  it('never for a desk test, or without a clear stroke', () => {
    expect(motionOnlyResult({ reason: { kind: 'too_short', movedM: 0, minM: 500 }, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: START })).toBeNull()
    expect(motionOnlyResult({ reason: LOST, strokes: { report: { ...strokes(0).report, available: false, medianStrokesPerMin: null }, paddling: null, rests: [] }, startMs: START, clockOffsetMs: START })).toBeNull()
  })

  it('without the tracker clock it cannot place rests, so it claims none', () => {
    expect(motionOnlyResult({ reason: LOST, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: null })!.stops).toEqual([])
  })

  it('the plain summary says only what the motion data shows', () => {
    const r = motionPaddle()
    expect(r.insight).toBe("A 24-min paddle from the boat's motion: about 1,200 strokes at 50 spm. 1 rest. No distance or pace: the GPS lost the sky.")
    expect(plainInsight(r)).toBe(r.insight)
    const never = motionOnlyResult({ reason: { kind: 'no_gps', recordedS: 1800 }, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: START })!
    expect(never.insight).toMatch(/the GPS never found the sky\.$/)
    expect(roundStrokes(5234)).toBe('5,200')
    expect(roundStrokes(640)).toBe('640')
  })

  it('the AI is given no distance or pace, and told not to invent them', () => {
    const prompt = buildPrompt(motionPaddle(), { paddledAt: '2026-10-11T07:00:00Z', asOf: '2026-10-11T12:00:00Z' })
    expect(prompt).toContain('about 24 minutes paddling')
    expect(prompt).toContain('NO distance, speed, pace or route')
    expect(prompt).toContain('~50 spm, about 1,200 strokes')
    expect(prompt).toContain('Rests: 1')
    expect(prompt).not.toMatch(/\d km|\/500|Cruising/)
  })

  it('the share card shows no route, distance or pace', () => {
    const track = [0, 1, 2].map(s => ({ lat: 51.5 + s * 1e-4, lng: -0.9, timestamp: new Date(START + s * 1000) }))
    const result = motionOnlyResult({ reason: LOST, strokes: TWO_STRETCHES, startMs: START, clockOffsetMs: START, track })!
    const card = shareCard({ id: 'm', userId: 'u', createdAt: '', paddledAt: '2026-10-11T07:00:00Z', source: { type: 'device' }, doubleStrokeRate: false, note: '', insight: '', result })
    expect(card).toMatchObject({ distance: '—', pace: '—', duration: '24:00', spm: '50 spm', pts: [] })
  })

  it('reads when the recording started from its first timed row', () => {
    expect(recordingStart('timestamp,lat,lon\nnot-a-time,,\n2026-10-11T07:00:00Z,,\n2026-10-11T07:00:01Z,,')).toBe('2026-10-11T07:00:00.000Z')
    expect(recordingStart('ms,lat\n1,2')).toBeNull()
    expect(recordingStart('')).toBeNull()
  })
})

describe('in the history the AI and the coach profile read', () => {
  const sum = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
    id, createdAt: '', paddledAt: '2026-10-01T07:00:00Z', source: { type: 'device' }, durationS: 1800, distanceKm: 6,
    avgSR: 50, cruiseSpeed: 3, effortCount: 0, avgDps: null, note: '', insight: '', ...over,
  })
  const motion = sum('m', { distanceKm: 0, cruiseSpeed: 0, durationS: 1440, noGps: true })

  it('a past paddle without a map is its time paddling, never 0 km or a pace', () => {
    expect(historyBits(motion)).toEqual(['2026-10-01: 24 min paddling (no GPS, so no distance or pace)'])
    expect(historyBits(sum('a'))).toEqual(['2026-10-01: 6.0km', 'cruise 2:47/500'])
    expect(renderRelevant([{ summary: motion, reason: 'K1' }])).not.toMatch(/0\.0km|\/500/)
  })

  it("the plain coach profile's typical distance leaves it out", () => {
    expect(deterministicProfile([sum('a'), sum('b', { distanceKm: 8 }), motion])).toMatch(/^A paddler with 3 logged paddles, typically around 7\.0 km\./)
    expect(deterministicProfile([motion, motion, motion])).toMatch(/^A paddler with 3 logged paddles\./)
  })

  it('earns no pace or distance badges on its own page', () => {
    const before = [sum('a', { paddledAt: '2026-09-01T07:00:00Z' }), sum('b', { paddledAt: '2026-09-10T07:00:00Z' })]
    const h = paddleHighlights({ paddledAt: '2026-10-01T07:00:00Z', cruiseSpeed: 0, distanceKm: 0, avgSR: 50, avgDps: null }, before)
    expect(h.join(' ')).not.toMatch(/fastest|Fastest|Longest|s\/500|km/)
  })
})

describe('never offered for compare, sections or similar paddles', () => {
  // Two paddles up the same 1 km straight; one of them lost its GPS but kept those points.
  const pts = Array.from({ length: 400 }, (_, i) => ({ t: i, lat: 51.5 + (i * 2.5) / 110_540, lng: -0.9, speed: 2.5, sr: 50, dps: 3 }))
  const session = (id: string, over: Partial<AnalysisResult> = {}): AnalysisSession => ({
    id, userId: 'u', createdAt: '', paddledAt: '2026-10-01T07:00:00Z', source: { type: 'device' }, doubleStrokeRate: false, note: '', insight: '',
    result: { durationS: 400, distanceKm: 1, avgSpeed: 2.5, avgSR: 50, avgDps: 3, cruiseSpeed: 2.5, strokeRateDoubled: false, points: pts, stops: [], surges: [], sets: [], insight: '', ...over },
  })
  const withMap = session('a')
  const without = session('m', { noGps: { reason: LOST, strokes: 1200 } })

  it('similar paddles and the race board leave it out', () => {
    const found = findSimilar(withMap, [withMap, session('b'), without], 20, 300)
    expect(found.ok && found.matches.map(m => m.sessionId)).toEqual(['b'])
    const race = buildRace(withMap, [without], 20, 300)
    expect('racers' in race && race.racers.map(r => r.sessionId)).toEqual(['a'])
  })

  it('has no passes through a section', () => {
    const sec = sectionOf(pts, 20, 300)!
    expect(passesIn('u', withMap, sec).length).toBe(1)
    expect(passesIn('u', without, sec)).toEqual([])
  })

  it('is never the same outing as another recording', () => {
    expect(isSameOuting(withMap, session('b'))).toBe(true)
    expect(isSameOuting(withMap, without)).toBe(false)
  })
})
