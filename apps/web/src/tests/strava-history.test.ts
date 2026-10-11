// @vitest-environment node
// Older Strava paddles (#415): connecting Strava brings in about the last
// month, IMPORT OLDER PADDLES goes further back. The list skips paddles already
// in, each import costs one Strava request, and "slow down" (429) is reported
// so the page can wait and carry on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { createCaller } from '@paddlesnitch/api'
import { putStravaTokens, setStravaAutoImport, getStravaAutoImport, getStravaHistoryImportedAt } from '@paddlesnitch/core/strava-storage'
import { saveSession, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import { stravaHistory } from '@paddlesnitch/analysis/strava-history'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const DAY = 86_400_000
const NOW = Date.parse('2026-10-11T12:00:00Z')

type Act = { id: number; name: string; sport_type: string; start_date: string; distance: number; moving_time: number }
const act = (id: number, daysAgo: number, sport = 'Kayaking'): Act =>
  ({ id, name: `paddle ${id}`, sport_type: sport, start_date: new Date(NOW - daysAgo * DAY).toISOString().replace('.000', ''), distance: 5000, moving_time: 1800 })

let dir: string, me: TestUser, requests: string[]
let activities: Act[]
let limited: (url: string) => boolean
beforeEach(async () => {
  dir = await makeDataDir()
  me = await makeUser('Me')
  await putStravaTokens(me.id, { athleteId: 1, athleteName: 'Me', accessToken: 'tok', refreshToken: 'r', expiresAt: Math.floor(Date.now() / 1000) + 3600 })
  requests = []
  limited = () => false
  activities = [act(101, 3), act(102, 10, 'Ride'), act(103, 20, 'Rowing'), act(104, 45), act(105, 400)]
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input)
    requests.push(url)
    if (limited(url)) return new Response('slow down', { status: 429 })
    if (url.includes('/athlete/activities')) {
      const after = Number(new URL(url).searchParams.get('after') ?? 0) * 1000
      const page = Number(new URL(url).searchParams.get('page'))
      return Response.json(page > 1 ? [] : activities.filter(a => Date.parse(a.start_date) > after))
    }
    const m = /activities\/(\d+)\/streams/.exec(url)
    if (m) {
      const pts: [number, number][] = Array.from({ length: 600 }, (_, i) => [51.46 + i * 0.00003, -0.93])
      return Response.json({ latlng: { data: pts }, time: { data: pts.map((_, i) => i * 3) } })
    }
    return new Response('not found', { status: 404 })
  }))
})
afterEach(async () => { vi.unstubAllGlobals(); await cleanDataDir(dir) })

function stravaPaddle(id: string, stravaActivityId: number): AnalysisSession {
  return { id, userId: me.id, createdAt: '2026-10-01T00:00:00Z', paddledAt: '2026-10-01T00:00:00Z',
    source: { type: 'strava', stravaActivityId }, doubleStrokeRate: false, note: '', insight: '',
    result: { points: [], surges: [], stops: [], distanceKm: 5, durationS: 1800, cruiseSpeed: 3, avgSR: null, avgDps: null, insight: '' } } as unknown as AnalysisSession
}

describe('the Strava paddles to bring in', () => {
  it('the last month: paddles only, oldest first, skipping ones already in', async () => {
    await saveSession(stravaPaddle('in-already', 101))
    const h = await stravaHistory(me.id, 31, NOW)
    expect(h).toMatchObject({ status: 'ok', alreadyIn: 1 })
    expect(h.status === 'ok' && h.toImport.map(a => a.id)).toEqual([103])
    expect(requests[0]).toContain(`after=${Math.floor((NOW - 31 * DAY) / 1000)}`)
  })

  it('everything: no date limit', async () => {
    const h = await stravaHistory(me.id, null, NOW)
    expect(h.status === 'ok' && h.toImport.map(a => a.id)).toEqual([105, 104, 103, 101])
    expect(requests[0]).not.toContain('after=')
  })

  it('not connected, or Strava says slow down: says which', async () => {
    const other = await makeUser('Other')
    expect(await stravaHistory(other.id, 31, NOW)).toEqual({ status: 'not_connected' })
    limited = () => true
    expect(await stravaHistory(me.id, 31, NOW)).toEqual({ status: 'rate_limited' })
  })
})

describe('bringing one in', () => {
  it('costs one Strava request (the list already said what and when), and lands in Paddles', async () => {
    const a = act(104, 45)
    const r = await as(me).sources.importStravaPaddle({ id: 104, sport: a.sport_type, startDate: a.start_date })
    expect(r.status).toBe('imported')
    const strava = requests.filter(u => u.includes('strava.com'))   // (weather and river flow are looked up too)
    expect(strava).toHaveLength(1)
    expect(strava[0]).toContain('/activities/104/streams')
    const list = await as(me).paddles.sessions()
    expect(list.map(s => (s.source as { stravaActivityId?: number }).stravaActivityId)).toContain(104)
  })

  it("reports Strava's slow-down instead of skipping the paddle", async () => {
    limited = url => url.includes('/streams')
    const r = await as(me).sources.importStravaPaddle({ id: 104, sport: 'Kayaking', startDate: act(104, 45).start_date })
    expect(r).toEqual({ status: 'skipped', reason: 'rate_limited' })
  })

  it('a non-paddling activity is not brought in, and costs nothing', async () => {
    const r = await as(me).sources.importStravaPaddle({ id: 102, sport: 'Ride', startDate: act(102, 10).start_date })
    expect(r).toEqual({ status: 'skipped', reason: 'not_water_sport' })
    expect(requests).toHaveLength(0)
  })
})

describe('the first month happens once', () => {
  it('is marked done, and turning auto-import off and on keeps that mark', async () => {
    expect((await as(me).sources.stravaHistory({ since: 'first' })).firstImportDone).toBe(false)
    await as(me).sources.stravaHistoryDone()
    expect((await as(me).sources.stravaHistory({ since: 'first' })).firstImportDone).toBe(true)
    await setStravaAutoImport(me.id, false)
    expect(await getStravaAutoImport(me.id)).toBe(false)
    expect(await getStravaHistoryImportedAt(me.id)).not.toBeNull()
  })
})
