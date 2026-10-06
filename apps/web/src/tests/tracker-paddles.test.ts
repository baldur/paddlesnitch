// @vitest-environment node
// A tracker recording becomes a paddle by itself (docs/features/one-paddle.md,
// phase 2): made when the track lands, given stroke rate when the motion data
// lands, never twice, and never losing what the paddler set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { sidecar, trackCsv } from './tracker-fixtures'

// Weather and river flow are external HTTP.
vi.mock('@paddlesnitch/timing/weather', () => ({ getWeatherAt: () => Promise.resolve(null) }))
// The written summary is the slow step just before a paddle is saved, which
// lets a test land the motion data mid-call. No AI: no summary (the plain one).
const duringSummary = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }))
vi.mock('@paddlesnitch/analysis/llm', () => ({
  generateInsight: async () => { const h = duringSummary.hook; duringSummary.hook = null; await h?.(); return null },
}))
vi.mock('@paddlesnitch/timing/river-flow', () => ({ getFlowAt: () => Promise.resolve(null) }))

// Capture after() so the upload route test can run the scheduled job.
const afterFns: Array<() => unknown> = []
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { afterFns.push(fn) } }
})

import { storeDeviceSession, storeDeviceMotion, listUserDeviceSessions } from '@/lib/devices'
import { paddleForRecording, trackerPaddleId } from '@paddlesnitch/analysis/tracker-paddle'
import { getSession, saveSession, listSessionSummaries, updateSessionNote, updateSessionBoat } from '@paddlesnitch/analysis/analysis-store'
import { handleSessionUpload } from '@/lib/session-upload'

const USER = 'user-tp'
const DEVICE = '435AC17C'
const NAME = 'track_20261006_090000.csv'
const TRACK = trackCsv(300, 9, { startMs: 400_000 })
const MOTION = sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 })

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  duringSummary.hook = null
  afterFns.length = 0
})
afterEach(async () => { await cleanDataDir(dataDir) })

async function recording(): Promise<string> {
  const meta = await storeDeviceSession(
    { deviceId: DEVICE, userId: USER, filename: NAME, startedAt: '2026-10-06T09:00:00Z', endedAt: '2026-10-06T09:05:00Z', distanceMetres: 750, points: 300 },
    TRACK,
  )
  return meta.sessionId
}
const addMotion = () => storeDeviceMotion(DEVICE, USER, NAME, MOTION, 3000)

describe('a tracker recording becomes a paddle by itself', () => {
  it('makes the paddle when the track lands, without stroke rate yet', async () => {
    const id = await recording()
    expect(await paddleForRecording(USER, DEVICE, id)).toEqual({ status: 'created', paddleId: trackerPaddleId(id) })
    const p = (await getSession(USER, trackerPaddleId(id)))!
    expect(p.source).toEqual({ type: 'device', deviceId: DEVICE, deviceSessionId: id })
    expect(p.result.avgSR).toBeNull()
  })

  it('adds stroke rate when the motion data lands, keeping the note and boat', async () => {
    const id = await recording()
    await paddleForRecording(USER, DEVICE, id)
    await updateSessionNote(USER, trackerPaddleId(id), 'felt strong')
    await updateSessionBoat(USER, trackerPaddleId(id), 'K1', null)
    await addMotion()

    expect(await paddleForRecording(USER, DEVICE, id)).toEqual({ status: 'updated', paddleId: trackerPaddleId(id) })
    const p = (await getSession(USER, trackerPaddleId(id)))!
    expect(p.result.avgSR).toBeGreaterThan(52)
    expect(p.result.avgSR).toBeLessThan(60)
    expect(p.note).toBe('felt strong')
    expect(p.boatClass).toBe('K1')
    expect(p.doubleStrokeRate).toBe(false)
  })

  it('never makes two paddles for one recording', async () => {
    const id = await recording()
    await paddleForRecording(USER, DEVICE, id)
    await addMotion()
    await paddleForRecording(USER, DEVICE, id)
    expect(await paddleForRecording(USER, DEVICE, id)).toMatchObject({ status: 'unchanged' })
    expect((await listSessionSummaries(USER)).length).toBe(1)
  })

  it('lets the motion call win when it lands while the GPS-only paddle is being made', async () => {
    const id = await recording()
    // The motion data lands (and its own call runs to completion) while the
    // first call is still working on the GPS-only paddle.
    duringSummary.hook = async () => {
      await addMotion()
      expect(await paddleForRecording(USER, DEVICE, id)).toMatchObject({ status: 'created' })
    }
    expect(await paddleForRecording(USER, DEVICE, id)).toEqual({ status: 'skipped', reason: 'superseded' })
    const all = await listSessionSummaries(USER)
    expect(all.length).toBe(1)
    expect(all[0].avgSR).toBeGreaterThan(52)
  })

  it('updates a paddle added by hand before this existed, instead of making another', async () => {
    const id = await recording()
    const made = (await paddleForRecording(USER, DEVICE, id)) as { paddleId: string }
    const p = (await getSession(USER, made.paddleId))!
    // Re-file it under a random id, as a hand-added paddle has.
    await saveSession({ ...p, id: 'byhand123' })
    const { deleteSession } = await import('@paddlesnitch/analysis/analysis-store')
    await deleteSession(USER, made.paddleId)
    await addMotion()

    expect(await paddleForRecording(USER, DEVICE, id)).toEqual({ status: 'updated', paddleId: 'byhand123' })
    expect((await listSessionSummaries(USER)).length).toBe(1)
  })

  it('makes no paddle when the boat barely moved (a desk test)', async () => {
    const meta = await storeDeviceSession(
      { deviceId: DEVICE, userId: USER, filename: 'track_20261006_120000.csv', startedAt: '', endedAt: '', distanceMetres: 0, points: 300 },
      trackCsv(300, 0.3),
    )
    expect(await paddleForRecording(USER, DEVICE, meta.sessionId)).toEqual({ status: 'skipped', reason: 'too_short' })
    expect(await listSessionSummaries(USER)).toEqual([])
  })

  it('makes no paddle from a recording with no usable GPS', async () => {
    const meta = await storeDeviceSession(
      { deviceId: DEVICE, userId: USER, filename: 'track_20261006_100000.csv', startedAt: '', endedAt: '', distanceMetres: 0, points: 0 },
      'timestamp,ms,fix,lat,lon,speed_kmh\n,1000,0,,,0\n',
    )
    expect(await paddleForRecording(USER, DEVICE, meta.sessionId)).toEqual({ status: 'skipped', reason: 'no_track' })
    expect(await listSessionSummaries(USER)).toEqual([])
  })
})

describe('the upload routes make the paddle after answering', () => {
  const upload = (name: string, body: string) =>
    handleSessionUpload(new Request(`http://x/api/devices/sessions?filename=${name}`, { method: 'POST', body }), { deviceId: DEVICE, userId: USER })

  it('schedules a paddle for an accepted track, and again for its motion data', async () => {
    expect((await upload(NAME, TRACK)).status).toBe(201)
    expect(afterFns.length).toBe(1)
    await afterFns.shift()!()
    const [rec] = await listUserDeviceSessions(USER)
    expect((await getSession(USER, trackerPaddleId(rec.sessionId)))?.result.avgSR).toBeNull()

    expect((await upload(NAME.replace('.csv', '_imu.csv'), MOTION)).status).toBe(201)
    expect(afterFns.length).toBe(1)
    await afterFns.shift()!()
    expect((await getSession(USER, trackerPaddleId(rec.sessionId)))?.result.avgSR).toBeGreaterThan(52)
  })

  it('schedules nothing for a recording it refuses', async () => {
    expect((await upload('track_20261006_110000.csv', 'timestamp,ms,lat,lon\n,1,,\n')).status).toBe(422)
    expect(afterFns.length).toBe(0)
  })
})

describe('create-tracker-paddles (recordings uploaded before this)', () => {
  it('changes nothing on a dry run, and makes the missing paddles with --apply', async () => {
    const { run } = await import('../../scripts/create-tracker-paddles')
    const id = await recording()
    expect(await run(false)).toEqual({ create: 1 })
    expect(await listSessionSummaries(USER)).toEqual([])
    expect(await run(true)).toEqual({ created: 1 })
    expect(await getSession(USER, trackerPaddleId(id))).not.toBeNull()
    expect(await run(true)).toEqual({ unchanged: 1 })
  })

  it('leaves out recordings named with --skip', async () => {
    const { run } = await import('../../scripts/create-tracker-paddles')
    await recording()
    expect(await run(true, [NAME])).toEqual({})
    expect(await listSessionSummaries(USER)).toEqual([])
  })
})
