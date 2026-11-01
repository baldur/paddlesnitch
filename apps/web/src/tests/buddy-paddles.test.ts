// @vitest-environment node
// Seeing a buddy's paddles (docs/features/buddies-and-compare.md, phase 4).
// What a buddy may see, what they never see (notes, the AI summary, the share
// link, the owner's id or email), and that every "no" looks the same.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { createCaller } from '@paddlesnitch/api'
import { saveSession, shareSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const NOTE = 'private diary: knee hurt, told no one'
const AI = 'AI summary that quotes the diary: knee hurt'

function paddle(userId: string, id: string, paddledAt = '2026-10-01T07:00:00Z'): AnalysisSession {
  return {
    id, userId, createdAt: paddledAt, paddledAt, source: { type: 'file', filename: 'x.gpx' }, doubleStrokeRate: false,
    note: NOTE, insight: AI,
    result: {
      points: [{ t: 0, lat: 51.46, lng: -0.93, speed: 3, sr: 58, dps: 3 }, { t: 600, lat: 51.47, lng: -0.93, speed: 3, sr: 58, dps: 3 }],
      surges: [], stops: [], distanceKm: 1.8, durationS: 600, cruiseSpeed: 3, avgSR: 58, avgDps: 3,
      insight: AI, insightModel: 'some-model',
    },
  } as unknown as AnalysisSession
}

let dataDir: string, ann: TestUser, bob: TestUser, eve: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  ann = await makeUser('Ann'); bob = await makeUser('Bob'); eve = await makeUser('Eve')
  await as(bob).buddies.request({ userId: ann.id }); await as(ann).buddies.accept({ userId: bob.id })
  await saveSession(paddle(ann.id, 'p1', '2026-10-01T07:00:00Z'))
  await saveSession(paddle(ann.id, 'p2', '2026-10-03T07:00:00Z'))
})
afterEach(async () => { await cleanDataDir(dataDir) })

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code)

describe("a buddy's paddles", () => {
  it('a buddy sees the list, newest first, and nothing private in it', async () => {
    const r = await as(bob).buddies.paddles({ userId: ann.id })
    expect(r.name).toBe('Ann')
    expect(r.paddles.map(p => p.id)).toEqual(['p2', 'p1'])
    const text = JSON.stringify(r)
    expect(text).not.toContain('diary')
    expect(text).not.toContain('AI summary')
    expect(text).not.toContain(ann.email)
  })

  it('a buddy sees one paddle with its numbers, but never the note, the AI text, the model, the share link or the owner', async () => {
    await shareSession(ann.id, 'p1')
    const r = await as(bob).buddies.paddle({ userId: ann.id, id: 'p1' })
    expect(r.paddle.result.distanceKm).toBe(1.8)
    expect(r.paddle.result.points).toHaveLength(2)
    const text = JSON.stringify(r)
    expect(text).not.toContain('diary')
    expect(text).not.toContain('AI summary')
    expect(r.paddle.result.insightModel).toBeUndefined()
    expect(text).not.toContain('shareId')
    expect(text).not.toContain(ann.id)
    expect(text).not.toContain(ann.email)
  })

  it('a paddle its owner hid is in neither the list nor reachable by its address', async () => {
    expect(await as(ann).paddles.setHiddenFromBuddies({ id: 'p1', hidden: true })).toEqual({ hidden: true })
    expect((await as(bob).buddies.paddles({ userId: ann.id })).paddles.map(p => p.id)).toEqual(['p2'])
    expect(await code(as(bob).buddies.paddle({ userId: ann.id, id: 'p1' }))).toBe('NOT_FOUND')
    // Shown again: back for buddies.
    await as(ann).paddles.setHiddenFromBuddies({ id: 'p1', hidden: false })
    expect((await as(bob).buddies.paddles({ userId: ann.id })).paddles).toHaveLength(2)
  })

  it('the owner still sees a paddle they hid, marked as hidden', async () => {
    await as(ann).paddles.setHiddenFromBuddies({ id: 'p1', hidden: true })
    expect((await as(ann).paddles.get({ id: 'p1' })).hiddenFromBuddies).toBe(true)
  })

  it('with sharing off, a buddy sees nothing, and finds out nothing more than a stranger', async () => {
    await as(ann).buddies.setSharing({ paddles: false })
    expect(await code(as(bob).buddies.paddles({ userId: ann.id }))).toBe('NOT_FOUND')
    expect(await code(as(bob).buddies.paddle({ userId: ann.id, id: 'p1' }))).toBe('NOT_FOUND')
  })

  it('a stranger, or a former buddy, gets the same not-found as for a paddle that does not exist', async () => {
    expect(await code(as(eve).buddies.paddles({ userId: ann.id }))).toBe('NOT_FOUND')
    expect(await code(as(eve).buddies.paddle({ userId: ann.id, id: 'p1' }))).toBe('NOT_FOUND')
    expect(await code(as(bob).buddies.paddle({ userId: ann.id, id: 'does-not-exist' }))).toBe('NOT_FOUND')
    await as(ann).buddies.remove({ userId: bob.id })
    expect(await code(as(bob).buddies.paddles({ userId: ann.id }))).toBe('NOT_FOUND')
    expect(await code(as(bob).buddies.paddle({ userId: ann.id, id: 'p1' }))).toBe('NOT_FOUND')
  })

  it("someone who only asked can't see anything yet", async () => {
    await as(eve).buddies.request({ userId: ann.id })
    expect(await code(as(eve).buddies.paddles({ userId: ann.id }))).toBe('NOT_FOUND')
  })

  it("a buddy can't change a buddy's paddle (hide, note, delete): those are the owner's alone", async () => {
    expect(await code(as(bob).paddles.setHiddenFromBuddies({ id: 'p1', hidden: true }))).toBe('NOT_FOUND')
    expect(await code(as(bob).paddles.setNote({ id: 'p1', note: 'x' }))).toBe('NOT_FOUND')
    await as(bob).paddles.delete({ id: 'p1' })
    expect((await as(ann).paddles.get({ id: 'p1' })).note).toBe(NOTE)
  })
})

// A phone's paddle (C3) says Phone to its owner, a buddy and a share link (#789):
// they get `phone: true`, never the phone's ID.
describe('a paddle recorded on a phone', () => {
  const fromPhone = (userId: string, id: string) =>
    ({ ...paddle(userId, id, '2026-10-05T07:00:00Z'), source: { type: 'device', deviceId: 'P0123456789ABCDEF', deviceSessionId: 's1' } }) as AnalysisSession

  it('is marked phone everywhere, with no device ID for anyone but the owner', async () => {
    await saveSession(fromPhone(ann.id, 'ph'))
    const owner = as(ann)
    expect((await owner.paddles.list()).cards.find(c => c.id === 'ph')).toMatchObject({ sourceType: 'device', phone: true })
    expect((await owner.paddles.get({ id: 'ph' })).source).toMatchObject({ type: 'device', phone: true })
    expect((await as(bob).buddies.paddles({ userId: ann.id })).paddles.find(p => p.id === 'ph')?.source).toEqual({ type: 'device', phone: true })
    expect((await as(bob).buddies.paddle({ userId: ann.id, id: 'ph' })).paddle.source).toEqual({ type: 'device', phone: true })
    const link = await shareSession(ann.id, 'ph')
    expect((await createCaller({ user: null }).paddles.shared({ shareId: link!.shareId })).source).toEqual({ type: 'device', phone: true })
  })

  it('a tracker paddle is not marked', async () => {
    await saveSession({ ...fromPhone(ann.id, 'tr'), source: { type: 'device', deviceId: 'A1B2C3D4', deviceSessionId: 's2' } } as AnalysisSession)
    expect((await as(ann).paddles.list()).cards.find(c => c.id === 'tr')?.phone).toBeUndefined()
    expect((await as(bob).buddies.paddle({ userId: ann.id, id: 'tr' })).paddle.source).toEqual({ type: 'device' })
  })
})
