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
