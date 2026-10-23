// Live conditions for a plan (packages/waterways/src/live.ts, sun.ts): the
// gauges on a route, the Thames boards, daylight. Fixtures in
// src/tests/fixtures/waterways are trimmed real responses.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  eaGauges, gaugesAlong, opwGauges, parseThamesConditions, rwsGauges, rwsLatest, sepaGauges, stateOf, thamesReachesOnRoute, waterinfoGauges, pegelonlineGauges, bafuGauges, lv95ToWgs84, type Gauge,
} from '@paddlesnitch/waterways/live'
import { inDark, sunTimes } from '@paddlesnitch/waterways/sun'
import type { Feature, LatLng } from '@paddlesnitch/waterways/types'

const FX = path.join(__dirname, '../tests/fixtures/waterways')
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'))
const AT = '2026-10-17T00:00:00.000Z'
const minutes = (iso: string) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes() }

describe('sunrise and sunset', () => {
  it('match published times for London to within a few minutes', () => {
    const june = sunTimes('2027-06-21T12:00:00Z', [51.5074, -0.1278])!
    expect(Math.abs(minutes(june.sunrise) - (3 * 60 + 43))).toBeLessThanOrEqual(3)    // 04:43 BST
    expect(Math.abs(minutes(june.sunset) - (20 * 60 + 21))).toBeLessThanOrEqual(3)    // 21:21 BST
    const dec = sunTimes('2027-12-21T12:00:00Z', [51.5074, -0.1278])!
    expect(Math.abs(minutes(dec.sunrise) - (8 * 60 + 4))).toBeLessThanOrEqual(3)
    expect(Math.abs(minutes(dec.sunset) - (15 * 60 + 53))).toBeLessThanOrEqual(3)
  })

  it('night is dark, noon is not, and Inverness gets a longer June day than London', () => {
    expect(inDark('2027-06-21T01:00:00Z', [51.5, -0.12])).toBe(true)
    expect(inDark('2027-06-21T12:00:00Z', [51.5, -0.12])).toBe(false)
    const len = (at: LatLng) => { const s = sunTimes('2027-06-21T12:00:00Z', at)!; return Date.parse(s.sunset) - Date.parse(s.sunrise) }
    expect(len([57.48, -4.22])).toBeGreaterThan(len([51.5, -0.12]))
  })
})

describe('gauges', () => {
  it("EA: the upstream stage on the gauge's own scale; stations with no river named are left out", () => {
    const g = eaGauges(fixture('ea-level-stations-sample.json').items)
    const marsh = g.find(x => x.id === '2495TH')!
    expect(marsh).toMatchObject({ name: 'Marsh Lock', river: 'River Thames', datum: 'stage' })
    expect(marsh.measure).toMatch(/2495TH-level-stage-i-15_min-mASD$/)
    expect(eaGauges([{ stationReference: 'X1', lat: 51, long: 0, measures: [{ '@id': 'm', qualifier: 'Stage', unitName: 'mASD' }] }])).toEqual([])
    expect(eaGauges([{ stationReference: 'X2', lat: 51, long: 0, riverName: 'River Y', measures: [{ '@id': 'm', qualifier: 'Stage', unitName: 'mAOD' }] }])[0].datum).toBe('aod')
  })

  it('OPW: level sensors only, and only stations OPW lets us republish', () => {
    expect(opwGauges(fixture('opw-latest-sample.json')).map(g => g.id)).toEqual(['0000001041', '0000001043'])
  })

  it('Rijkswaterstaat: locations that measure water height, on NAP', () => {
    const g = rwsGauges(fixture('rws-catalogue-sample.json'))
    expect(g.map(x => x.id).sort()).toEqual(['dronten.roggebotsluis.vossemeer', 'genemuiden', 'groenevaart.boven'])   // not the location measuring something else
    expect(g.find(x => x.id === 'genemuiden')).toMatchObject({ source: 'rws', name: 'Genemuiden', datum: 'nap', at: [52.633395, 6.033154] })
  })

  it("Rijkswaterstaat: the newest fresh reading per location, in metres; the 1980s archives it mixes in don't count", () => {
    const latest = rwsLatest(fixture('rws-latest-sample.json'), Date.parse('2026-10-21T05:00:00Z'))
    expect([...latest.keys()]).toEqual(['genemuiden'])                                   // Roggebotsluis's newest is from 2023
    expect(latest.get('genemuiden')).toEqual({ value: -0.5, at: '2026-10-21T03:20:00.000Z' })
    expect(rwsLatest(fixture('rws-latest-sample.json'), Date.parse('2026-10-22T05:00:00Z')).size).toBe(0)   // a day old: not now
  })

  it('Flanders (waterinfo.be): fresh levels in metres, the river from "Place/River"; empty and stale readings left out', () => {
    const g = waterinfoGauges(fixture('waterinfo-layer-sample.json'), Date.parse('2026-10-21T15:00:00Z'))
    expect(g.map(x => [x.name, x.river, x.valueM])).toEqual([
      ['Kieldrecht', 'Noordzuidverbinding', 0.829], ['Malderen', 'Grote Molenbeek', 6.621], ['Koersel', 'Zwarte beek', 38.222],
    ])
    expect(g[0]).toMatchObject({ source: 'waterinfo', readAt: '2026-10-21T14:15:00.000Z' })
  })

  it('Germany (PEGELONLINE): fresh levels in metres with the WSV\'s own state, names in title case; no level series, or stale, left out', () => {
    const g = pegelonlineGauges(fixture('pegelonline-stations-sample.json'), Date.parse('2026-10-22T17:30:00Z'))
    expect(g.map(x => [x.name, x.river, x.valueM, x.state])).toEqual([
      ['Ketzin', 'Untere Havel-Wasserstrasse', 2.45, 'normal'], ['Schöna', 'Elbe', 3.12, 'high'],
    ])
    expect(g[0]).toMatchObject({ source: 'pegelonline', id: '580430', at: [52.463153, 12.856784], readAt: '2026-10-22T17:15:00.000Z', datum: 'stage' })
  })

  it('Switzerland (BAFU): the water level in metres above sea level, river or lake by name; high only past the first flood threshold; stale or no level left out', () => {
    const g = bafuGauges(fixture('bafu-hydro-sample.json'), Date.parse('2026-10-23T15:30:00Z'))
    expect(g.map(x => [x.name, x.river, x.valueM, x.state ?? null, x.datum])).toEqual([
      ['Bern, Schönau', 'Aare', 501.76, null, 'aod'], ['Unterägeri', 'Ägerisee', 723.27, null, 'aod'], ['Testhoch', 'Aare', 501.76, 'high', 'aod'],
    ])
    expect(g[0]).toMatchObject({ source: 'bafu', id: '2135', readAt: '2026-10-23T14:50:00.000Z' })
    expect(g[0].at[0]).toBeCloseTo(46.93, 1)   // Bern
    expect(g[0].at[1]).toBeCloseTo(7.45, 1)
  })

  it('Swiss LV95 to latitude and longitude (swisstopo\'s approximate formulas)', () => {
    const [lat, lng] = lv95ToWgs84(2600000, 1200000)   // the old Bern observatory, the projection's origin
    expect(lat).toBeCloseTo(46.95108, 4)
    expect(lng).toBeCloseTo(7.43864, 4)
  })

  it('SEPA: the station list with positions', () => {
    expect(sepaGauges([['ts_id', 'station_name', 'station_latitude', 'station_longitude'], ['51453010', 'Perth', '56.39', '-3.43']]))
      .toEqual([{ source: 'sepa', id: '51453010', name: 'Perth', at: [56.39, -3.43], datum: 'stage' }])
  })

  it('on a route: gauges on the rivers it paddles, not a tributary gauged where it joins; unnamed ones only close', () => {
    const line: LatLng[] = [[51.5, -1], [51.5, -0.9]]
    const g = (id: string, at: LatLng, river?: string): Gauge => ({ source: river ? 'ea' : 'opw', id, name: id, at, river })
    const on = gaugesAlong(line, [
      g('main', [51.505, -0.95], 'River Thames'),           // ~560 m off, named, on the route's river
      g('trib', [51.503, -0.97], 'River Dun'),              // close, but a tributary
      g('near-unnamed', [51.501, -0.93]),                   // ~110 m off
      g('far-unnamed', [51.505, -0.92]),                    // ~560 m off
    ], ['River Thames'])
    expect(on.map(x => x.id)).toEqual(['main', 'near-unnamed'])   // in travel order
  })

  it('thins to an even spread when there are many', () => {
    const line: LatLng[] = [[51.5, -1], [51.5, 0]]
    const many: Gauge[] = Array.from({ length: 30 }, (_, i) => ({ source: 'opw' as const, id: String(i), name: String(i), at: [51.5, -1 + i / 30] as LatLng }))
    const on = gaugesAlong(line, many, [], 5)
    expect(on.map(x => x.id)).toEqual(['0', '7', '15', '22', '29'])
  })

  it('says high, normal or low against the usual range', () => {
    const t = { low: 0.1, high: 0.4 }
    expect([stateOf(0.5, t), stateOf(0.2, t), stateOf(0.05, t), stateOf(0.2, undefined)]).toEqual(['high', 'normal', 'low', undefined])
  })
})

describe('Thames boards', () => {
  const page = fixture('thames-conditions-sample.json').details.body as string

  it('reads every reach and when the page was updated', () => {
    const c = parseThamesConditions(page)
    expect(c.updated).toMatch(/\d{1,2} \w+ 20\d\d/)
    expect(c.reaches.length).toBeGreaterThan(5)
    expect(c.reaches[0]).toMatchObject({ from: 'Iffley Lock', to: 'Sandford Lock' })
  })

  it('tells red boards from yellow boards from none', () => {
    const row = (reach: string, cond: string) => `<tr> <td>${reach}</td> <td>${cond}</td> </tr>`
    const c = parseThamesConditions(`<table><tbody>${row('A Lock to B Lock', 'Strong stream - red boards')}${row('B Lock to C Lock', 'Caution strong stream - yellow boards')}${row('C Lock to D Lock', 'Caution stream decreasing - yellow boards')}${row('D Lock to E Lock', 'No stream warnings')}</tbody></table>`)
    expect(c.reaches.map(r => r.level)).toEqual(['strong', 'caution', 'caution', 'none'])
  })

  it('picks the reaches a route is on: past one of its locks, or starting between them', () => {
    const lock = (name: string, at: LatLng): Feature => ({ id: name, kind: 'lock', name, at, source: { source: 'ea-thames-locks', fetchedAt: AT } })
    const locks = [lock('Marsh Lock', [51.5286, -0.8855]), lock('Hambleden Lock', [51.5604, -0.8687]), lock('Hurley Lock', [51.5486, -0.8124])]
    const reaches = [
      { from: 'Marsh Lock', to: 'Hambleden Lock', condition: '', level: 'none' as const },
      { from: 'Hambleden Lock', to: 'Hurley Lock', condition: '', level: 'none' as const },
    ]
    // A short paddle wholly between Marsh and Hambleden, past neither lock.
    const between: LatLng[] = [[51.538, -0.893], [51.548, -0.887]]
    expect(thamesReachesOnRoute(reaches, locks, between).map(r => r.to)).toEqual(['Hambleden Lock'])
  })
})
