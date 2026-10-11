// @vitest-environment node
// Every pass through a section (sections.passes / sections.passLine): yours and
// your buddies', laps counted, the same way round only, along the same water,
// each outing once, and nothing from a paddle you may not see.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { createCaller } from '@paddlesnitch/api'
import { saveSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import { allPasses, crossingSignNear } from '@paddlesnitch/timing/geo'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const LAT0 = 51.46, LNG0 = -0.93
const toLL = (x: number, y: number) => ({ lat: LAT0 + y / 110_540, lng: LNG0 + x / (Math.cos(51 * Math.PI / 180) * 111_320) })
// A paddle along a path in metres, 3 m/s, one point a second.
function points(path: [number, number][], speed = 3, sr: number | null = null) {
  const out: { t: number; lat: number; lng: number; speed: number; sr: number | null; dps: null }[] = []; let seg = 0, along = 0, t = 0
  const L = (i: number) => Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
  while (seg < path.length - 1) { const f = along / L(seg), [x0, y0] = path[seg], [x1, y1] = path[seg + 1]; out.push({ t, ...toLL(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f), speed, sr, dps: null }); along += speed; t += 1; while (seg < path.length - 1 && along >= L(seg)) { along -= L(seg); seg++ } }
  return out
}
function paddle(userId: string, id: string, at: string, path: [number, number][], opts: { speed?: number; sr?: number; source?: string } = {}): AnalysisSession {
  const pts = points(path, opts.speed, opts.sr ?? null)
  return { id, userId, createdAt: at, paddledAt: at, source: { type: opts.source ?? 'strava' }, doubleStrokeRate: false, note: 'private', insight: 's',
    result: { points: pts, surges: [], stops: [], distanceKm: pts.length * 3 / 1000, durationS: pts.length, cruiseSpeed: 3, avgSR: null, avgDps: null, insight: 's' } } as unknown as AnalysisSession
}
// Up the river and back down a lane 20 m over (the gates span both lanes).
const club = (turn: number): [number, number][] => [[0, 0], [0, turn], [20, turn], [20, 0]]
// The section: 1 km to 2 km up the river on the source paddle (3 m a point).
const SECTION = { sourceId: 'source', aIdx: 333, bIdx: 667 }

let dataDir: string, me: TestUser, ann: TestUser, eve: TestUser
beforeEach(async () => {
  dataDir = await makeDataDir()
  me = await makeUser('Me'); ann = await makeUser('Ann'); eve = await makeUser('Eve')
  await saveSession(paddle(me.id, 'source', '2026-10-10T07:00:00Z', club(5000)))
  await saveSession(paddle(me.id, 'fast', '2026-10-07T07:00:00Z', club(4000), { speed: 4 }))
  await saveSession(paddle(me.id, 'fast-tracker', '2026-10-07T07:00:20Z', club(4000), { speed: 4, sr: 70, source: 'device' }))  // the same outing, twice
  await saveSession(paddle(me.id, 'laps', '2026-10-01T07:00:00Z', [...club(3000), ...club(3000)]))
  await saveSession(paddle(me.id, 'downstream-only', '2026-09-20T07:00:00Z', [[20, 3000], [20, 0]]))
  await saveSession(paddle(me.id, 'other-channel', '2026-09-15T07:00:00Z', [[0, 0], [0, 950], [50, 1000], [50, 2000], [0, 2050], [0, 3000]]))
  await saveSession(paddle(ann.id, 'hers', '2026-10-10T07:01:00Z', club(5100), { speed: 3.5 }))
  await saveSession(paddle(ann.id, 'hers-hidden', '2026-10-02T07:00:00Z', club(5000)))
  await saveSession(paddle(eve.id, 'strangers', '2026-10-10T07:00:00Z', club(5000)))
  await as(ann).buddies.request({ userId: me.id }); await as(me).buddies.accept({ userId: ann.id })
  await as(ann).paddles.setHiddenFromBuddies({ id: 'hers-hidden', hidden: true })
})
afterEach(async () => { await cleanDataDir(dataDir) })

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code)

describe('every pass of a section', () => {
  it('lists each pass the same way round, fastest first: laps twice, one outing once, a buddy by name', async () => {
    const r = await as(me).sections.passes(SECTION)
    expect(r.sectionM).toBeGreaterThan(950); expect(r.sectionM).toBeLessThan(1050)
    const tag = (p: { name: string; paddleId: string; n: number }) => `${p.name}:${p.paddleId}#${p.n}`
    // 4 m/s, then 3.5 m/s, then the 3 m/s ones (in any order: they tie).
    // The tracker recording wins over its Strava twin: it has stroke rate.
    expect(r.passes.slice(0, 2).map(tag)).toEqual(['You:fast-tracker#1', 'Ann:hers#1'])
    expect(r.passes.slice(2).map(tag).sort()).toEqual(['You:laps#1', 'You:laps#2', 'You:source#1'])
    expect(r.passes[0].elapsedS).toBeCloseTo(250, -1)
    expect(r.passes[0].avgSR).toBe(70)
    expect(r.passes[0].paceS500).toBeCloseTo(r.passes[0].elapsedS / (r.sectionM / 500))
    expect(r.passes.filter(p => !p.mine).map(p => p.name)).toEqual(['Ann'])
    expect(JSON.stringify(r)).not.toContain(ann.email)
  })

  it("leaves out passes the wrong way, by another channel, hidden, a stranger's, and a buddy's with sharing off", async () => {
    const ids = (await as(me).sections.passes(SECTION)).passes.map(p => p.paddleId)
    for (const no of ['downstream-only', 'other-channel', 'hers-hidden', 'strangers', 'fast']) expect(ids).not.toContain(no)
    await as(ann).buddies.setSharing({ paddles: false })
    expect((await as(me).sections.passes(SECTION)).passes.every(p => p.mine)).toBe(true)
  })

  it("works from a buddy's paddle too, and from nobody else's", async () => {
    const r = await as(me).sections.passes({ sourceId: 'hers', owner: ann.id, aIdx: 286, bIdx: 571 })
    expect(r.passes.some(p => p.paddleId === 'source')).toBe(true)
    expect(await code(as(eve).sections.passes({ sourceId: 'hers', owner: ann.id, aIdx: 286, bIdx: 571 }))).toBe('NOT_FOUND')
    expect(await code(as(me).sections.passes({ sourceId: 'hers-hidden', owner: ann.id, aIdx: 333, bIdx: 667 }))).toBe('NOT_FOUND')
    expect(await code(as(me).sections.passes({ sourceId: 'strangers', owner: eve.id, aIdx: 333, bIdx: 667 }))).toBe('NOT_FOUND')
    expect(await code(as(me).sections.passes({ ...SECTION, bIdx: 340 }))).toBe('BAD_REQUEST')
  })

  it("gives one pass's line, but never one from a paddle you may not see", async () => {
    const line = await as(me).sections.passLine({ ...SECTION, paddleOwner: ann.id, paddleId: 'hers', n: 1 })
    expect(line.length).toBeGreaterThan(250); expect(line.length).toBeLessThan(310)   // ~1 km at 3.5 m/s
    expect(Object.keys(line[0]).sort()).toEqual(['dps', 'lat', 'lng', 'speed', 'sr', 't'])
    expect(await code(as(me).sections.passLine({ ...SECTION, paddleOwner: ann.id, paddleId: 'hers-hidden', n: 1 }))).toBe('NOT_FOUND')
    expect(await code(as(me).sections.passLine({ ...SECTION, paddleOwner: eve.id, paddleId: 'strangers', n: 1 }))).toBe('NOT_FOUND')
    expect(await code(as(me).sections.passLine({ ...SECTION, paddleOwner: me.id, paddleId: 'laps', n: 3 }))).toBe('NOT_FOUND')
  })
})

describe('allPasses', () => {
  const line = (y: number): [[number, number], [number, number]] => [[LAT0 + y / 110_540, LNG0 - 0.001], [LAT0 + y / 110_540, LNG0 + 0.001]]
  const track = (path: [number, number][]) => points(path).map(p => ({ lat: p.lat, lng: p.lng, timestamp: new Date(Date.parse('2026-10-01T07:00:00Z') + p.t * 1000) }))

  it('finds each lap, pairing each finish with the latest start before it', () => {
    const p = allPasses(track([[0, 0], [0, 600], [5, 0], [10, 600], [15, 0]]), line(100), line(500))
    expect(p).toHaveLength(2)
    expect(p[0].finishMs - p[0].startMs).toBeCloseTo(400_000 / 3, -3)
  })

  it('without signs pairs either way round; with signs keeps only that direction', () => {
    const t = track([[0, 0], [0, 600], [5, 0], [10, 600]])   // up, down, up
    const up = crossingSignNear(t, line(100), 30)
    expect(allPasses(t, line(100), line(500), up, crossingSignNear(t, line(500), 170))).toHaveLength(2)
    const down = allPasses(t, line(500), line(100))
    expect(down).toHaveLength(1)                                               // the down leg
    // Asking for the up way: never the down leg (what's left is a loop round, which
    // passesIn then drops for not following the section's water).
    expect(allPasses(t, line(500), line(100), up, up).map(p => p.startMs)).not.toContain(down[0].startMs)
  })
})
