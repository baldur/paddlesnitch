// @vitest-environment node
// Contract test for the tRPC paddles router — calls the procedure in-process via
// createCaller (the same path SSR uses) against a real temp local store. This is
// the QA seam: the router's behaviour + auth gating is testable without HTTP,
// and its types are shared with web + mobile so they can't drift.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { createCaller } from '@paddlesnitch/api'

const USER = { id: 'user-1', email: 'p@example.com', displayName: 'Pat' }

async function writeSession(dir: string, id: string, s: object) {
  const p = path.join(dir, 'analysis', USER.id, id)
  await fs.mkdir(p, { recursive: true })
  await fs.writeFile(path.join(p, 'session.json'), JSON.stringify(s))
}

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trpc-paddles-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('paddles.list', () => {
  it('returns the signed-in user\'s paddles as cards + rolled-up totals, newest first', async () => {
    await writeSession(dir, 'aaa', {
      id: 'aaa', paddledAt: '2026-09-01T10:00:00.000Z', source: { type: 'file' }, boatClass: 'K1',
      result: { distanceKm: 4, durationS: 1200, cruiseSpeed: 3.1, avgSR: 60, points: [{ lat: 51.1, lng: -0.9 }, { lat: 51.2, lng: -0.8 }] },
    })
    await writeSession(dir, 'bbb', {
      id: 'bbb', paddledAt: '2026-09-10T10:00:00.000Z', source: { type: 'strava' },
      result: { distanceKm: 6, durationS: 1800, cruiseSpeed: 3.4, avgSR: null, points: [] },
    })

    const res = await createCaller({ user: USER }).paddles.list()

    expect(res.cards.map(c => c.id)).toEqual(['bbb', 'aaa'])          // newest first
    expect(res.cards[0].sourceType).toBe('strava')
    expect(res.cards[1].boatClass).toBe('K1')
    expect(res.cards[1].route.length).toBe(2)                          // thumbnail route derived
    expect(res.totals).toEqual({ count: 2, totalKm: 10, totalS: 3000, since: '2026-09-01T10:00:00.000Z' })
  })

  it('is empty for a user with no paddles', async () => {
    const res = await createCaller({ user: USER }).paddles.list()
    expect(res.cards).toEqual([])
    expect(res.totals.count).toBe(0)
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    await expect(createCaller({ user: null }).paddles.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('paddles get / setNote / delete round-trip', () => {
  const base = {
    id: 'p1', userId: USER.id, paddledAt: '2026-09-01T10:00:00.000Z', source: { type: 'file' }, note: '',
    result: { distanceKm: 4, durationS: 1200, cruiseSpeed: 3.1, avgSR: 60, points: [] },
  }

  it('reads, updates the note, and deletes a paddle (owner-scoped)', async () => {
    await writeSession(dir, 'p1', base)
    const caller = createCaller({ user: USER })

    expect((await caller.paddles.get({ id: 'p1' })).id).toBe('p1')

    const noted = await caller.paddles.setNote({ id: 'p1', note: 'good one' })
    expect(noted.note).toBe('good one')
    expect((await caller.paddles.get({ id: 'p1' })).note).toBe('good one')

    await caller.paddles.delete({ id: 'p1' })
    await expect(caller.paddles.get({ id: 'p1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('get throws NOT_FOUND for a missing paddle', async () => {
    await expect(createCaller({ user: USER }).paddles.get({ id: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('me', () => {
  it('returns the current user, or null when signed out', async () => {
    expect(await createCaller({ user: USER }).me()).toEqual({ user: USER })
    expect(await createCaller({ user: null }).me()).toEqual({ user: null })
  })
})

// The AI summary is written from the owner's diary notes and coach profile, so it
// can repeat private text. A shared paddle is public: it must show only the plain
// summary built from its own numbers.
describe('paddles.shared never exposes the AI summary', () => {
  it('replaces the AI summary with the plain summary from the paddle\'s own numbers', async () => {
    const { saveSession, shareSession } = await import('@paddlesnitch/analysis/analysis-store')
    const { analyseTrack } = await import('@paddlesnitch/analysis/analysis')
    const t0 = Date.parse('2026-09-01T10:00:00Z')
    const track = Array.from({ length: 600 }, (_, i) => ({
      lat: 51.5 + i * 0.00003, lng: -0.1, timestamp: new Date(t0 + i * 1000), strokeRate: 60,
    }))
    const result = analyseTrack(track, {})
    const plain = result.insight
    await saveSession({
      id: 'p1', userId: USER.id, createdAt: '2026-09-01T11:00:00Z', paddledAt: '2026-09-01T10:00:00Z',
      source: { type: 'file' }, doubleStrokeRate: false, note: 'knee still hurts after the fall',
      insight: 'You mentioned your knee still hurts after the fall, so take it easy.',
      result: { ...result, insight: 'You mentioned your knee still hurts after the fall, so take it easy.', insightModel: 'some-model' },
    } as never)
    const shared = await shareSession(USER.id, 'p1')

    const res = await createCaller({ user: null }).paddles.shared({ shareId: shared!.shareId })

    expect(JSON.stringify(res)).not.toContain('knee')
    expect(res.result.insight).toBe(plain)
    expect(res.result.insightModel).toBeUndefined()
  })
})

// The tracker's stroke rate comes from its motion data and already counts every
// stroke, so picking a kayak class must not double it (one-paddle.md, phase 1).
describe('paddles.setBoat and stroke-rate doubling', () => {
  async function saved(id: string, source: object) {
    const { saveSession } = await import('@paddlesnitch/analysis/analysis-store')
    const { analyseTrack } = await import('@paddlesnitch/analysis/analysis')
    const t0 = Date.parse('2026-09-01T10:00:00Z')
    const track = Array.from({ length: 300 }, (_, i) => ({ lat: 51.5 + i * 0.00003, lng: -0.1, timestamp: new Date(t0 + i * 1000), strokeRate: 56 }))
    await saveSession({
      id, userId: USER.id, createdAt: '2026-09-01T11:00:00Z', paddledAt: '2026-09-01T10:00:00Z',
      source, doubleStrokeRate: false, note: '', insight: '', result: analyseTrack(track, {}),
    } as never)
  }

  it('doubles a file paddle when a kayak class is picked (it counts one side)', async () => {
    await saved('f1', { type: 'file' })
    const s = await createCaller({ user: USER }).paddles.setBoat({ id: 'f1', boatClass: 'K1', seat: null })
    expect(s.doubleStrokeRate).toBe(true)
  })

  it('does not double a tracker paddle when a kayak class is picked', async () => {
    await saved('d1', { type: 'device', deviceId: '435AC17C', deviceSessionId: 's1' })
    const s = await createCaller({ user: USER }).paddles.setBoat({ id: 'd1', boatClass: 'K1', seat: null })
    expect(s.doubleStrokeRate).toBe(false)
    expect(s.result.strokeRateDoubled).toBe(false)
  })
})

describe('paddles.byRecording', () => {
  it('maps each tracker recording to its paddle, and nothing else', async () => {
    await writeSession(dir, 't-rec1', { id: 't-rec1', userId: USER.id, paddledAt: '2026-10-01T09:00:00Z', source: { type: 'device', deviceId: '435AC17C', deviceSessionId: 'rec1' }, result: { durationS: 600, distanceKm: 2, points: [], surges: [], stops: [], sets: [] } })
    await writeSession(dir, 'hand2', { id: 'hand2', userId: USER.id, paddledAt: '2026-10-02T09:00:00Z', source: { type: 'device', deviceId: '435AC17C', deviceSessionId: 'rec2' }, result: { durationS: 600, distanceKm: 2, points: [], surges: [], stops: [], sets: [] } })
    await writeSession(dir, 'f1', { id: 'f1', userId: USER.id, paddledAt: '2026-10-03T09:00:00Z', source: { type: 'file' }, result: { durationS: 600, distanceKm: 2, points: [], surges: [], stops: [], sets: [] } })
    expect(await createCaller({ user: USER }).paddles.byRecording()).toEqual({ rec1: 't-rec1', rec2: 'hand2' })
  })
})

describe('the same outing from two sources (paddles.sameOuting, paddles.compareOuting)', () => {
  // One boat heading north from 09:00 at 2.2 m/s, recorded from `at`.
  const outing = (id: string, at: string, seconds: number, type: string, opts: { lng?: number; sr?: number } = {}) => {
    const since = (Date.parse(at) - Date.parse('2026-10-06T09:00:00Z')) / 1000
    return writeSession(dir, id, {
      id, userId: USER.id, paddledAt: at, source: { type },
      result: {
        durationS: seconds - 1, distanceKm: seconds * 2.2 / 1000, cruiseSpeed: 2.2, avgSR: opts.sr ?? null,
        surges: [], stops: [], sets: [],
        points: Array.from({ length: seconds }, (_, t) => ({ t, lat: 51.46 + (since + t) * 2.2 / 111_000, lng: opts.lng ?? -0.93, speed: 2.2, sr: opts.sr ?? null, dps: null })),
      },
    })
  }

  it('finds the watch recording of a tracker paddle, and not other paddles', async () => {
    await outing('t-rec1', '2026-10-06T09:00:00Z', 1200, 'device', { sr: 56 })
    await outing('strava1', '2026-10-06T09:01:00Z', 1100, 'strava', { sr: 28 })
    await outing('nextday', '2026-10-07T09:00:00Z', 1200, 'strava')
    await outing('elsewhere', '2026-10-06T09:00:00Z', 1200, 'file', { lng: -0.9 })
    const caller = createCaller({ user: USER })
    expect(await caller.paddles.sameOuting({ id: 't-rec1' })).toEqual([{ id: 'strava1', sourceType: 'strava', paddledAt: '2026-10-06T09:01:00Z' }])

    const cmp = await caller.paddles.compareOuting({ a: 't-rec1', b: 'strava1' })
    expect(cmp.same).toBe(true)
    if (!cmp.same) return
    expect(cmp.gap?.medianM).toBe(0)
    expect(cmp.strokeRate[0]).toMatchObject({ a: 56, b: 28 })
    expect((await caller.paddles.compareOuting({ a: 't-rec1', b: 'nextday' })).same).toBe(false)
  })

  it("can't look at someone else's paddle", async () => {
    await expect(createCaller({ user: USER }).paddles.sameOuting({ id: 'not-mine' })).rejects.toThrow()
  })
})
