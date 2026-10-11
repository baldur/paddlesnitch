// @vitest-environment node
// Which of your paddles are offered for comparison (paddles.comparable), on
// paddles saved the way real ones are, and who may ask about which paddle.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { createCaller } from '@paddlesnitch/api'
import { saveSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import { listKeys, deleteObject } from '@paddlesnitch/core/storage'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const LAT0 = 51.46, LNG0 = -0.93
const toLL = (x: number, y: number) => ({ lat: LAT0 + y / 110_540, lng: LNG0 + x / (Math.cos(51 * Math.PI / 180) * 111_320) })
function points(path: [number, number][]) {
  const out: { t: number; lat: number; lng: number; speed: number; sr: null; dps: null }[] = []; let seg = 0, along = 0, t = 0
  const L = (i: number) => Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  while (seg < path.length - 1) { const f = along / L(seg), [x0, y0] = path[seg], [x1, y1] = path[seg + 1]; out.push({ t, ...toLL(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f), speed: 3, sr: null, dps: null }); along += 3; t += 1; while (seg < path.length - 1 && along >= L(seg)) { along -= L(seg); seg++ } }
  return out
}
function paddle(userId: string, id: string, at: string, path: [number, number][], source = 'strava'): AnalysisSession {
  const pts = points(path)
  const km = pts.length * 3 / 1000
  return { id, userId, createdAt: at, paddledAt: at, source: { type: source }, doubleStrokeRate: false, note: 'private', insight: 's',
    result: { points: pts, surges: [], stops: [], distanceKm: km, durationS: pts.length, cruiseSpeed: 3, avgSR: null, avgDps: null, insight: 's' } } as unknown as AnalysisSession
}
// The club route: 5 km up and back, turning at slightly different places.
const club = (turn: number): [number, number][] => [[0, 0], [0, turn], [20, turn], [20, 0]]

let dataDir: string, me: TestUser, ann: TestUser, eve: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  me = await makeUser('Me'); ann = await makeUser('Ann'); eve = await makeUser('Eve')
  await saveSession(paddle(me.id, 'target', '2026-10-10T07:00:00Z', club(5000)))
  await saveSession(paddle(me.id, 'club-a', '2026-10-07T07:00:00Z', club(4700)))
  await saveSession(paddle(me.id, 'club-a-tracker', '2026-10-07T07:00:30Z', club(4700), 'device'))   // the same outing, twice
  await saveSession(paddle(me.id, 'club-b', '2026-09-30T07:00:00Z', club(5300)))
  await saveSession(paddle(me.id, 'part', '2026-09-01T07:00:00Z', [[0, 0], [0, 1500]]))
  await saveSession(paddle(me.id, 'downstream', '2026-08-01T07:00:00Z', [[0, 0], [0, -4000], [20, -4000], [20, 0]]))
  await saveSession(paddle(me.id, 'other-river', '2026-10-09T07:00:00Z', [[30_000, 0], [30_000, 5000]]))
})
afterEach(async () => { await cleanDataDir(dataDir) })

describe('paddles worth comparing', () => {
  // The same outing recorded twice (tracker + Strava) counts once: either recording.
  const club7 = (id: string) => (id === 'club-a-tracker' ? 'club-a' : id)

  it('offers the same route first (most water shared), each outing once, then part of it, never another river or direction', async () => {
    const r = await as(me).paddles.comparable({ id: 'target' })
    expect(r.map(x => `${club7(x.id)}:${x.kind}`)).toEqual(['club-b:same_route', 'club-a:same_route', 'part:partly'])
    expect(r[0].sharedM).toBeGreaterThan(r[1].sharedM)
  })

  it("builds the squares for paddles saved before they existed, and gives the same answer", async () => {
    for (const k of await listKeys(`analysis/${me.id}/`)) if (k.endsWith('/cells.json')) await deleteObject(k)
    const r = await as(me).paddles.comparable({ id: 'target' })
    expect(r.map(x => club7(x.id))).toEqual(['club-b', 'club-a', 'part'])
    // Every candidate's squares were rebuilt (the paddle being compared is worked out in memory).
    expect((await listKeys(`analysis/${me.id}/`)).filter(k => k.endsWith('/cells.json')).length).toBe(6)
  })

  it("on a buddy's paddle: the outing you paddled together first, then your same-route paddles", async () => {
    await as(ann).buddies.request({ userId: me.id }); await as(me).buddies.accept({ userId: ann.id })
    await saveSession(paddle(ann.id, 'hers', '2026-10-10T07:01:00Z', club(5100)))
    const r = await as(me).paddles.comparable({ id: 'hers', owner: ann.id })
    expect(r[0]).toMatchObject({ id: 'target', kind: 'together' })
    expect(r.slice(1).map(x => x.kind)).toEqual(['same_route', 'same_route', 'partly'])
  })

  it("can't be asked about a paddle you may not see (stranger, hidden, sharing off): the same NOT_FOUND", async () => {
    await saveSession(paddle(ann.id, 'hers', '2026-10-10T07:01:00Z', club(5100)))
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code)
    expect(await code(as(eve).paddles.comparable({ id: 'hers', owner: ann.id }))).toBe('NOT_FOUND')
    await as(ann).buddies.request({ userId: me.id }); await as(me).buddies.accept({ userId: ann.id })
    await as(ann).paddles.setHiddenFromBuddies({ id: 'hers', hidden: true })
    expect(await code(as(me).paddles.comparable({ id: 'hers', owner: ann.id }))).toBe('NOT_FOUND')
    expect(await code(as(me).paddles.comparable({ id: 'nope' }))).toBe('NOT_FOUND')
  })

  it('never offers anything from the other person', async () => {
    await as(ann).buddies.request({ userId: me.id }); await as(me).buddies.accept({ userId: ann.id })
    await saveSession(paddle(ann.id, 'hers', '2026-10-10T07:01:00Z', club(5100)))
    await saveSession(paddle(ann.id, 'hers-too', '2026-10-01T07:00:00Z', club(5000)))
    const r = await as(me).paddles.comparable({ id: 'hers', owner: ann.id })
    expect(r.map(x => x.id)).not.toContain('hers-too')
  })
})
