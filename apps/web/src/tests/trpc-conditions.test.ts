// @vitest-environment node
// Live conditions for a plan (tRPC plan.conditions): the network is stubbed
// with trimmed real responses, so this tests our reading of them, not the
// sources' uptime. A source that fails is reported, never read as "fine".
import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { createCaller } from '@paddlesnitch/api'
import { clearLiveCaches } from '@paddlesnitch/waterways/live-store'

const anon = createCaller({ user: null })
const FX = path.join(__dirname, 'fixtures/waterways')
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'))
// Up the Thames past Marsh Lock to Henley (in the Devizes–Westminster stand-in data).
const MARSH_STRETCH = { start: [51.5205, -0.8930] as [number, number], finish: [51.5395, -0.9010] as [number, number] }

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
function stubNetwork(fail: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input)
    if (fail.some(f => url.includes(f))) return new Response('down', { status: 503 })
    if (url.includes('/id/stations?parameter=level')) return respond(fixture('ea-level-stations-sample.json'))
    if (url.includes('/data/readings?latest')) return respond(fixture('ea-latest-sample.json'))
    if (url.includes('/id/stations/2495TH')) return respond(fixture('ea-station-2495TH-sample.json'))
    if (url.includes('river-thames-current-river-conditions')) return respond(fixture('thames-conditions-sample.json'))
    if (url.includes('waterlevel.ie')) return respond(fixture('opw-latest-sample.json'))
    if (url.includes('sepa.org.uk')) return respond([['ts_id', 'station_name', 'station_latitude', 'station_longitude']])
    return new Response('not stubbed', { status: 404 })
  }))
}

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearLiveCaches() })
afterEach(async () => { await cleanDataDir(dataDir); vi.unstubAllGlobals() })

describe('live conditions along a route', () => {
  it("reads the gauges on the route, their level against the usual range, and the Thames boards for its reaches", async () => {
    stubNetwork()
    const c = (await anon.plan.conditions(MARSH_STRETCH))!
    expect(c.unavailable).toEqual([])
    const marsh = c.gauges.find(g => g.id === '2495TH')!
    expect(marsh).toMatchObject({ name: 'Marsh Lock', river: 'River Thames', typical: expect.any(Object) })
    expect(typeof marsh.valueM).toBe('number')
    expect(['low', 'normal', 'high']).toContain(marsh.state)
    expect(c.thames?.reaches.some(r => r.from === 'Marsh Lock' || r.to === 'Marsh Lock')).toBe(true)
  })

  it('says which source failed instead of pretending all is well', async () => {
    stubNetwork(['river-thames-current-river-conditions', '/data/readings?latest'])
    const c = (await anon.plan.conditions(MARSH_STRETCH))!
    expect(c.unavailable).toEqual(expect.arrayContaining(['GOV.UK river conditions', 'Environment Agency']))
    expect(c.thames).toBeNull()
    expect(c.gauges.find(g => g.id === '2495TH')?.valueM).toBeUndefined()
  })

  it('nothing for a route that isn’t on the water', async () => {
    stubNetwork()
    expect(await anon.plan.conditions({ start: [51.32, -1.2], finish: [51.33, -1.2] })).toBeNull()
  })
})
