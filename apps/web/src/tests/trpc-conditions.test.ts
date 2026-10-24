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
import { clearLiveCaches, conditionsAlong } from '@paddlesnitch/waterways/live-store'

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
    if (url.includes('OphalenCatalogus')) return respond(fixture('rws-catalogue-sample.json'))
    if (url.includes('download.waterinfo.be')) return respond(fixture('waterinfo-layer-sample.json'))
    if (url.includes('pegelonline.wsv.de')) return respond(fixture('pegelonline-stations-sample.json'))
    if (url.includes('hydrodaten.admin.ch')) return respond(fixture('bafu-hydro-sample.json'))
    if (url.includes('hydroobs.smhi.se')) return respond(fixture('smhi-flow-sample.json'))
    if (url.includes('OphalenLaatsteWaarnemingen')) return respond(fixture('rws-latest-sample.json'))
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

  it('a Dutch gauge on the route, its level on NAP; stations with no fresh reading are left out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T05:00:00Z'))   // the fixture's Genemuiden reading is from 03:20 UTC
    try {
      stubNetwork()
      // Along the Zwarte Water at Genemuiden; Roggebotsluis's newest reading is from 2023.
      const c = await conditionsAlong([[52.6300, 6.0300], [52.6370, 6.0360]], [], [])
      expect(c.unavailable).toEqual([])
      expect(c.gauges.map(g => [g.id, g.valueM, g.datum])).toEqual([['genemuiden', -0.5, 'nap']])
      expect(c.gauges[0].state).toBeUndefined()   // no usual range on NAP
    } finally { vi.useRealTimers() }
  })

  it('a Flemish gauge on the route, matched by river name (waterinfo.be)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'))
    try {
      stubNetwork()
      const c = await conditionsAlong([[51.069695, 5.265089], [51.075695, 5.265089]], ['Zwarte beek'], [])
      expect(c.gauges.find(g => g.source === 'waterinfo')).toMatchObject({ name: 'Koersel', river: 'Zwarte beek', valueM: 38.222 })
    } finally { vi.useRealTimers() }
  })

  it('a German gauge on the route, its river matched with ß as ss, with the WSV\'s own state (PEGELONLINE)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T17:30:00Z'))
    try {
      stubNetwork()
      const c = await conditionsAlong([[52.457153, 12.856784], [52.469153, 12.856784]], ['Untere Havel-Wasserstraße'], [])
      expect(c.gauges.find(g => g.source === 'pegelonline')).toMatchObject({ name: 'Ketzin', valueM: 2.45, state: 'normal', url: expect.stringContaining('pegelonline.wsv.de') })
    } finally { vi.useRealTimers() }
  })

  it('a Swiss station on the route, by river name (BAFU), its level above sea level', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T15:30:00Z'))
    try {
      stubNetwork()
      const [lat, lng] = [46.9335, 7.4492]
      const c = await conditionsAlong([[lat - 0.004, lng], [lat + 0.004, lng]], ['Aare'], [])
      expect(c.gauges.find(g => g.source === 'bafu')).toMatchObject({ name: 'Bern, Schönau', valueM: 501.76, url: expect.stringContaining('hydrodaten.admin.ch/de/') })
    } finally { vi.useRealTimers() }
  })

  it('a Swedish station on the route, by distance (its catchment is no river name: a tributary station would be hidden), with its flow (SMHI)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T21:30:00Z'))
    try {
      stubNetwork()
      const c = await conditionsAlong([[63.4292, 18.3034], [63.4372, 18.3034]], ['Vallsjöbäcken'], [])   // a tributary's name, not the catchment's
      expect(c.gauges.find(g => g.source === 'smhi')).toMatchObject({ name: 'Västersel', flowM3s: 19.4, url: expect.stringContaining('smhi.se/data/sjoar-och-vattendrag/vattenforing/waterdischargeDaily/1583') })
    } finally { vi.useRealTimers() }
  })

  it('nothing for a route that isn’t on the water', async () => {
    stubNetwork()
    expect(await anon.plan.conditions({ start: [51.32, -1.2], finish: [51.33, -1.2] })).toBeNull()
  })
})
