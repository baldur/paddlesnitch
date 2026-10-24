// @vitest-environment node
// The public read-only API (#511): plans, places and public trials as stable
// JSON, the same visibility as the pages, no user ids, sources credited.
import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'
import { putJson } from '@/lib/storage'
import { GET as plan } from '@/app/api/v1/plan/route'
import { GET as places } from '@/app/api/v1/places/route'
import { GET as trials } from '@/app/api/v1/trials/route'
import { GET as trial } from '@/app/api/v1/trials/[trialId]/route'
import { GET as leaderboard } from '@/app/api/v1/trials/[trialId]/leaderboard/route'
import { GET as openapi } from '@/app/api/v1/openapi.json/route'

const req = (p: string) => new NextRequest(new URL(p, 'https://paddlesnitch.com'))
const params = (trialId: string) => ({ params: Promise.resolve({ trialId }) })
const DW_START = '51.355333,-1.994961', DW_FINISH = '51.500833,-0.121667'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('GET /api/v1/plan', () => {
  it('plans Devizes to Westminster with units in the names, GeoJSON, timed stops and credits', async () => {
    const res = await plan(req(`/api/v1/plan?from=${DW_START}&to=${DW_FINISH}&pace=8&portage=3&at=2027-04-17T08:00:00Z`))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await res.json()
    expect(body.api_version).toBe('1')
    expect(body.plan.distance_km).toBeGreaterThan(195)
    expect(body.plan.distance_km).toBeLessThan(207)
    expect(body.plan.duration_s).toBeGreaterThan(body.plan.moving_s)
    expect(body.plan.route.geometry.type).toBe('LineString')
    const [lng, lat] = body.plan.route.geometry.coordinates[0]
    expect(lat).toBeCloseTo(51.355, 2)   // GeoJSON is [lng, lat]
    expect(lng).toBeCloseTo(-1.995, 2)
    const lock = body.plan.stops.find((s: { kind: string }) => s.kind === 'lock')
    expect(lock).toMatchObject({ id: expect.stringMatching(/^stop-out-/), portage: true, km: expect.any(Number), eta: expect.stringMatching(/^2027-04-17T/) })
    expect(body.plan.portages).toBeGreaterThan(50)
    expect(body.attribution.map((a: { source: string }) => a.source)).toContain('osm')
    expect(body.links.page).toBe(`https://paddlesnitch.com/plan?from=51.355333%2C-1.994961&to=51.500833%2C-0.121667`)
  })

  it('takes ends by name, like a /plan link', async () => {
    const body = await (await plan(req('/api/v1/plan?from=guyers-lock&to=aldermaston-wharf'))).json()
    expect(body.plan.start.waterway).toMatch(/Kennet and Avon/)
    expect(body.plan.stops.length).toBeGreaterThan(0)
  })

  it('says what is wrong, with a code', async () => {
    expect((await plan(req('/api/v1/plan?from=guyers-lock'))).status).toBe(400)
    expect((await plan(req(`/api/v1/plan?from=${DW_START}&to=${DW_FINISH}&pace=99`))).status).toBe(400)
    const notFound = await plan(req(`/api/v1/plan?from=nowhere-at-all-xyz&to=${DW_FINISH}`))
    expect(notFound.status).toBe(404)
    expect((await notFound.json()).error.code).toBe('not_found')
    const offWater = await plan(req(`/api/v1/plan?from=${DW_START}&to=51.32,-1.2`))
    expect(offWater.status).toBe(422)
    expect((await offWater.json()).error.code).toBe('finish_off_water')
  })
})

describe('GET /api/v1/places', () => {
  it('finds places on the water by name', async () => {
    const body = await (await places(req('/api/v1/places?q=Aldermaston'))).json()
    expect(body.places[0]).toMatchObject({ name: expect.stringMatching(/Aldermaston/), lat: expect.any(Number), lng: expect.any(Number) })
    expect((await places(req('/api/v1/places?q=a'))).status).toBe(400)
  })
})

describe('GET /api/v1/trials', () => {
  const course = {
    id: 'c1', name: 'Harbour 500', sport: 'kayak', type: 'point_to_point',
    startLine: [[64.15, -21.95], [64.151, -21.95]], finishLine: [[64.155, -21.95], [64.156, -21.95]],
    distanceMetres: 500, adminUserId: 'u-admin', visibility: 'public', createdAt: '2026-01-01T00:00:00Z',
  }
  const base = { courseId: 'c1', date: '2026-06-01', status: 'open', adminUserId: 'u-admin', participation: 'public', invitedUserIds: ['u-secret'], createdAt: '2026-01-01T00:00:00Z' }
  beforeEach(async () => {
    await putJson('courses/c1/metadata.json', course)
    await putJson('trials/pub/metadata.json', { ...base, id: 'pub', name: 'Public race', visibility: 'public', submitToken: 'tok' })
    await putJson('trials/priv/metadata.json', { ...base, id: 'priv', name: 'Private race', visibility: 'private' })
    await putJson('trials/pub/leaderboard.json', [
      { entryId: 'e2', userId: 'u-2', displayName: 'Bo', submittedAt: '2026-06-01T12:00:00Z', raceDate: '2026-06-01', boatClass: 'K1', crew: [], totalElapsedSeconds: 130.25, splits: [{ distance: 500, elapsedSeconds: 130.25 }] },
      { entryId: 'e1', userId: 'u-1', displayName: 'Ann', submittedAt: '2026-06-01T11:00:00Z', raceDate: '2026-06-01', boatClass: 'K1', crew: [], totalElapsedSeconds: 120.5, splits: [] },
    ])
  })

  it('lists only public trials, with their course, and no tokens or invite lists', async () => {
    const body = await (await trials(req('/api/v1/trials'))).json()
    expect(body.trials.map((t: { id: string }) => t.id)).toEqual(['pub'])
    expect(body.trials[0].course).toMatchObject({ name: 'Harbour 500', distance_km: 0.5, start_line: [{ lat: 64.15, lng: -21.95 }, { lat: 64.151, lng: -21.95 }] })
    expect(JSON.stringify(body)).not.toMatch(/tok|u-secret|u-admin/)
  })

  it('a private trial is 404, as on the site', async () => {
    expect((await trial(req('/api/v1/trials/priv'), params('priv'))).status).toBe(404)
    expect((await leaderboard(req('/api/v1/trials/priv/leaderboard'), params('priv'))).status).toBe(404)
    expect((await trial(req('/api/v1/trials/pub'), params('pub'))).status).toBe(200)
  })

  it('the leaderboard is fastest first, with names but no user ids', async () => {
    const body = await (await leaderboard(req('/api/v1/trials/pub/leaderboard'), params('pub'))).json()
    expect(body.results.map((r: { display_name: string; rank: number }) => [r.rank, r.display_name])).toEqual([[1, 'Ann'], [2, 'Bo']])
    expect(body.results[1].splits).toEqual([{ distance_m: 500, elapsed_s: 130.25 }])
    expect(JSON.stringify(body)).not.toMatch(/u-1|u-2|entryId|e1/)
  })
})

describe('the OpenAPI description', () => {
  it('describes every path that has a handler, and nothing else', async () => {
    const spec = await (await openapi(req('/api/v1/openapi.json'))).json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers[0].url).toBe('https://paddlesnitch.com')
    const root = path.join(__dirname, '../app')
    for (const p of Object.keys(spec.paths)) {
      expect(fs.existsSync(path.join(root, p.replace(/\{(\w+)\}/g, '[$1]'), 'route.ts')), p).toBe(true)
    }
  })
})
