// @vitest-environment node
// A tracker recording whose GPS failed becomes a paddle without a map (#414),
// from its motion data, once that lands: time paddling, stroke rate, strokes,
// no distance. A desk test or a short splash still makes none, and the paddle
// is never offered for compare, sections or similar paddles.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { sidecar, trackCsv, lostTrackCsv } from './tracker-fixtures'

vi.mock('@paddlesnitch/timing/weather', () => ({ getWeatherAt: async () => null }))
vi.mock('@paddlesnitch/timing/river-flow', () => ({ getFlowAt: async () => null }))
// No AI: the plain summary.
vi.mock('@paddlesnitch/analysis/llm', async (orig) => ({ ...(await orig<object>()), generateInsight: async () => null }))

import { storeDeviceSession, storeDeviceMotion } from '@/lib/devices'
import { paddleForRecording, trackerPaddleId } from '@paddlesnitch/analysis/tracker-paddle'
import { getSession, listSessionSummaries, saveSession } from '@paddlesnitch/analysis/analysis-store'
import { writePendingSummary } from '@paddlesnitch/analysis/pipeline'
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { createCaller } from '@paddlesnitch/api'

const DEVICE = '435AC17C'
const T0 = '2026-10-11T07:00:00Z'
// 15 minutes on the water; the GPS lost the sky 30 s in. Motion data for 14 minutes of it.
const LOST = lostTrackCsv(900, 30, 9, { startMs: 400_000, t0: T0 })
const MOTION = (seconds: number) => sidecar({ seconds, hz: 10, strokesPerMin: 50, startMs: 400_000 })

let dataDir: string, me: TestUser
const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
beforeEach(async () => { dataDir = await makeDataDir(); me = await makeUser('Me') })
afterEach(async () => { await cleanDataDir(dataDir) })

async function recording(name: string, csv: string): Promise<string> {
  const meta = await storeDeviceSession({ deviceId: DEVICE, userId: me.id, filename: name, startedAt: T0, endedAt: '', distanceMetres: 0, points: 900 }, csv)
  return meta.sessionId
}
const addMotion = (name: string, seconds: number) => storeDeviceMotion(DEVICE, me.id, name, MOTION(seconds), seconds * 10)

describe('a recording whose GPS failed', () => {
  it('becomes a paddle without a map when its motion data lands, and only once', async () => {
    const id = await recording('track_1.csv', LOST)
    // The track alone: the boat "moved" 75 m before the GPS was lost.
    expect(await paddleForRecording(me.id, DEVICE, id)).toEqual({ status: 'skipped', reason: 'too_short' })

    await addMotion('track_1.csv', 840)
    expect(await paddleForRecording(me.id, DEVICE, id)).toEqual({ status: 'created', paddleId: trackerPaddleId(id) })
    const p = (await getSession(me.id, trackerPaddleId(id)))!
    expect(isMotionOnly(p.result)).toBe(true)
    expect(p.paddledAt).toBe('2026-10-11T07:00:00.000Z')
    expect(p.source).toEqual({ type: 'device', deviceId: DEVICE, deviceSessionId: id })
    expect(p.result.noGps?.reason).toEqual({ kind: 'gps_lost', lostAfterS: 30, recordedS: 899 })
    expect(p.result.durationS).toBe(810)   // the last window ends inside the motion data
    expect(p.result.avgSR).toBeCloseTo(50, 0)
    expect(p.result.noGps?.strokes).toBeGreaterThan(650)
    expect(p.result).toMatchObject({ distanceKm: 0, cruiseSpeed: 0, avgDps: null })
    // The route from before the GPS was lost.
    expect(p.result.points.length).toBe(31)
    expect(p.insight).toMatch(/^A 14-min paddle from the boat's motion: about \d+ strokes at 50 spm\. No distance or pace: the GPS lost the sky\.$/)
    expect(p.insightPending).toBe(true)

    // Asked again (a retry, the motion upload twice): the same paddle, unchanged.
    expect(await paddleForRecording(me.id, DEVICE, id)).toEqual({ status: 'unchanged', paddleId: trackerPaddleId(id) })
    const [summary] = await listSessionSummaries(me.id)
    expect(summary).toMatchObject({ id: trackerPaddleId(id), noGps: true, distanceKm: 0, durationS: 810 })
  })

  it('the written summary is from those facts alone', async () => {
    const id = await recording('track_1.csv', LOST)
    await addMotion('track_1.csv', 840)
    await paddleForRecording(me.id, DEVICE, id)
    const p = (await writePendingSummary(me.id, trackerPaddleId(id)))!
    expect(p.insightPending).toBeUndefined()
    expect(p.insight).not.toMatch(/km|\/500/)
  })

  it('counts in the paddle count and time on the water, not in km', async () => {
    const id = await recording('track_1.csv', LOST)
    await addMotion('track_1.csv', 840)
    await paddleForRecording(me.id, DEVICE, id)
    const { totals } = await as(me).paddles.list()
    expect(totals).toMatchObject({ count: 1, totalKm: 0, totalS: 810 })
  })

  it('makes none from under 10 minutes of paddling', async () => {
    const id = await recording('track_1.csv', LOST)
    await addMotion('track_1.csv', 480)
    expect(await paddleForRecording(me.id, DEVICE, id)).toEqual({ status: 'skipped', reason: 'too_short' })
    expect(await listSessionSummaries(me.id)).toEqual([])
  })
})

describe('still no paddle', () => {
  it('from a desk test, even with motion data', async () => {
    const id = await recording('track_2.csv', trackCsv(900, 0.3, { startMs: 400_000, t0: T0 }))
    await addMotion('track_2.csv', 840)
    expect(await paddleForRecording(me.id, DEVICE, id)).toEqual({ status: 'skipped', reason: 'too_short' })
    expect(await listSessionSummaries(me.id)).toEqual([])
  })

  it('and a real paddle is made from its GPS as before', async () => {
    const id = await recording('track_3.csv', trackCsv(600, 9, { startMs: 400_000, t0: T0 }))
    expect(await paddleForRecording(me.id, DEVICE, id)).toMatchObject({ status: 'created' })
    expect(isMotionOnly((await getSession(me.id, trackerPaddleId(id)))!.result)).toBe(false)
  })
})

describe('never offered for compare, sections or similar paddles', () => {
  it('compare, same outing, sections and similar all leave it out', async () => {
    const lost = await recording('track_1.csv', LOST)
    await addMotion('track_1.csv', 840)
    await paddleForRecording(me.id, DEVICE, lost)
    const motionId = trackerPaddleId(lost)
    // A paddle with a map up the same water, the same morning.
    const real = await recording('track_3.csv', trackCsv(600, 9, { startMs: 400_000, t0: T0 }))
    await paddleForRecording(me.id, DEVICE, real)
    const realId = trackerPaddleId(real)
    const api = as(me)

    expect(await api.paddles.comparable({ id: motionId })).toEqual([])
    expect((await api.paddles.comparable({ id: realId })).map(x => x.id)).not.toContain(motionId)
    expect(await api.paddles.sameOuting({ id: realId })).toEqual([])
    await expect(api.sections.passes({ sourceId: motionId, aIdx: 0, bIdx: 20 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(api.similar.find({ sourceId: motionId, aIdx: 0, bIdx: 20 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const passes = await api.sections.passes({ sourceId: realId, aIdx: 10, bIdx: 400 })
    expect(passes.passes.map(p => p.paddleId)).toEqual([realId])
    const similar = await api.similar.find({ sourceId: realId, aIdx: 10, bIdx: 400 })
    expect(similar.ok && similar.matches.map(m => m.sessionId)).toEqual([])
  })

  it('a paddle without a map saved before the rule still has no route squares to match on', async () => {
    const lost = await recording('track_1.csv', LOST)
    await addMotion('track_1.csv', 840)
    await paddleForRecording(me.id, DEVICE, lost)
    const p = (await getSession(me.id, trackerPaddleId(lost)))!
    await saveSession(p)
    const { getRouteCells } = await import('@paddlesnitch/analysis/analysis-store')
    expect(await getRouteCells(me.id, p.id)).toEqual([])
  })
})
