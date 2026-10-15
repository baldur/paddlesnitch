// The national network (docs/features/waterways-uk-ireland.md): routing that
// keeps to the navigation, snapping and "what's along" on a grid index, the
// route/time split the server and browser share, and the places search.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { featuresAlong } from '@paddlesnitch/waterways/along'
import { readDbf } from '@paddlesnitch/waterways/ingest/dbf'
import { linksFromWays, type OsmWay } from '@paddlesnitch/waterways/ingest/osm'
import { featuresFromScottishCanals } from '@paddlesnitch/waterways/ingest/scottish-canals'
import { featuresFromWi } from '@paddlesnitch/waterways/ingest/waterways-ireland'
import { paddleCost, route, snap } from '@paddlesnitch/waterways/network'
import { buildPlaces, searchPlaces, type Place } from '@paddlesnitch/waterways/places'
import { computePlan, routePlan, timePlan } from '@paddlesnitch/waterways/plan'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { Feature, LatLng, NetLink, RegionDataset } from '@paddlesnitch/waterways/types'

const ds: RegionDataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8'))
const AT = '2026-10-12T00:00:00.000Z'

const way = (id: number, nodes: number[], coords: LatLng[], tags: Record<string, string> = {}): OsmWay =>
  ({ id, nodes, coords, tags: { waterway: 'river', ...tags } })

describe('paddle access from OSM tags', () => {
  it('reads canoe=* first, then boat=*, and marks culverts', () => {
    const links = linksFromWays([
      way(1, [1, 2], [[51, 0], [51, 0.01]], { boat: 'yes' }),
      way(2, [3, 4], [[52, 0], [52, 0.01]], { boat: 'no', canoe: 'yes' }),
      way(3, [5, 6], [[53, 0], [53, 0.01]], { boat: 'private' }),
      way(4, [7, 8], [[54, 0], [54, 0.01]], { tunnel: 'culvert' }),
      way(5, [9, 10], [[55, 0], [55, 0.01]]),
    ])
    expect(links.map(l => [l.boat, l.culvert])).toEqual([['yes', undefined], ['yes', undefined], ['no', undefined], [undefined, true], [undefined, undefined]])
  })

  it('keeps to the navigation rather than a shorter channel nobody may paddle', () => {
    // A navigation looping round (boat=yes, ~2.2 km) and a straight flood
    // channel between the same two junctions (untagged, ~1.4 km).
    const nav = way(1, [1, 2, 3], [[51.5, 0], [51.51, 0.01], [51.5, 0.02]], { boat: 'yes', name: 'River Navigation' })
    const channel = way(2, [1, 3], [[51.5, 0], [51.5, 0.02]], { name: 'Flood Relief Channel' })
    const links = linksFromWays([nav, channel])
    const r = route(links, snap(links, [51.5, -0.0001])!, snap(links, [51.5, 0.0201])!)!
    expect(new Set(r.legs.map(l => l.name))).toEqual(new Set(['River Navigation']))
    // …but takes the channel when it's the only water.
    const only = linksFromWays([channel])
    expect(route(only, snap(only, [51.5, 0])!, snap(only, [51.5, 0.02])!)).not.toBeNull()
  })

  it('costs culverts so much that a route goes round', () => {
    const l = (boat?: 'yes' | 'no', culvert?: true): NetLink => ({ id: 'x', name: '', form: 'inlandRiver', from: 'a', to: 'b', line: [], lengthM: 100, boat, culvert })
    expect([l('yes'), l(), l('no'), l(undefined, true)].map(paddleCost)).toEqual([100, 200, 400, 5000])
  })
})

describe('grid index', () => {
  it('snaps to the nearest link even when a long straight segment has no vertex nearby', () => {
    // One segment 30 km long: its middle crosses many grid cells with no vertex in them.
    const links = linksFromWays([way(1, [1, 2], [[51.5, -0.3], [51.5, 0.13]])], 0)
    const s = snap(links, [51.501, -0.08])!
    expect(s.dist).toBeLessThan(120)
  })

  it('returns nothing beyond maxM, and the nearest link without one', () => {
    const links = linksFromWays([way(1, [1, 2], [[51.5, 0], [51.5, 0.01]])])
    expect(snap(links, [51.6, 0.005], 2000)).toBeNull()
    expect(snap(links, [51.6, 0.005])!.dist).toBeGreaterThan(10_000)
  })

  it('finds features along a route whose vertices are far apart', () => {
    const line: LatLng[] = [[51.5, -0.3], [51.5, 0.13]]
    const lock: Feature = { id: 'mid', kind: 'lock', name: 'Middle Lock', at: [51.5005, -0.08], source: { source: 'curated', fetchedAt: AT } }
    expect(featuresAlong(line, [lock]).map(a => a.item.id)).toEqual(['mid'])
  })
})

describe('routing on the server, timing in the browser', () => {
  const { start, finish } = REGIONS.dw.check!
  it('routePlan then timePlan is the same plan as computePlan', () => {
    const input = { start, finish, shape: 'return' as const, paceKmh: 9, portageMinutes: 4, startAt: '2027-04-17T07:00:00.000Z' }
    const routed = routePlan(ds, input)
    if (typeof routed === 'string') throw new Error(routed)
    expect(timePlan(routed, input)).toEqual(computePlan(ds, input))
  })

  it('a routed plan carries no times, so pace changes need no new route', () => {
    const routed = routePlan(ds, { start, finish, shape: 'one_way' })
    if (typeof routed === 'string') throw new Error(routed)
    expect(routed.stops[0]).not.toHaveProperty('eta')
    const slow = timePlan(routed, { paceKmh: 6, portageMinutes: 3 }), fast = timePlan(routed, { paceKmh: 10, portageMinutes: 3 })
    expect(slow.totalS).toBeGreaterThan(fast.totalS)
    expect(slow.stops.map(s => s.feature.id)).toEqual(fast.stops.map(s => s.feature.id))
  })
})

describe('places search', () => {
  const links = ds.links
  const places: Place[] = buildPlaces([
    { at: [51.539, -0.901], tags: { name: 'Henley-on-Thames', place: 'town' } },
    { at: [51.4745, -0.9136], tags: { name: 'Sonning', place: 'village' } },
    { at: [52.2, -1.5], tags: { name: 'Henley-in-Arden', place: 'town' } },   // nowhere near our water
    { at: [51.5, -0.8], tags: { name: 'Nowhere Farm', place: 'farm' } },
  ], ds.features, links)

  it('keeps towns near the water and every named lock and weir', () => {
    const names = places.map(p => p.name)
    expect(names).toContain('Henley-on-Thames')
    expect(names).not.toContain('Henley-in-Arden')
    expect(names).not.toContain('Nowhere Farm')
    expect(places.some(p => p.kind === 'lock' && /Marsh Lock/.test(p.name))).toBe(true)
  })

  it('matches as you type, whole-name prefixes first, ignoring case and accents', () => {
    expect(searchPlaces(places, 'henl')[0].name).toBe('Henley-on-Thames')
    expect(searchPlaces(places, 'SONN').map(p => p.name)).toContain('Sonning')
    expect(searchPlaces(places, 'marsh').map(p => p.name).some(n => /Marsh Lock/.test(n))).toBe(true)
    const accented: Place[] = [{ name: 'Béal an Átha', kind: 'town', at: [53.4, -8] }]
    expect(searchPlaces(accented, 'beal').map(p => p.name)).toEqual(['Béal an Átha'])
    expect(searchPlaces(places, '  ')).toEqual([])
  })

  it('prefers bigger places, then nearer ones', () => {
    const ps: Place[] = [
      { name: 'Abbey Hamlet', kind: 'hamlet', at: [51.5, 0] },
      { name: 'Abbey Town', kind: 'town', at: [55, -3] },
      { name: 'Abbey Village', kind: 'village', at: [51.5, 0.01] },
      { name: 'Abbey Village', kind: 'village', at: [54, -2] },
    ]
    expect(searchPlaces(ps, 'abbey', [51.5, 0]).map(p => `${p.name}@${p.at[0]}`)).toEqual(['Abbey Town@55', 'Abbey Village@51.5', 'Abbey Village@54', 'Abbey Hamlet@51.5'])
  })
})

const FX = path.join(__dirname, '../tests/fixtures/waterways')

describe('Scottish Canals (shapefile attribute tables)', () => {
  const dbf = (name: string) => readDbf(new Uint8Array(fs.readFileSync(path.join(FX, name))))

  it('reads a dBASE table', () => {
    const rows = dbf('scottish-canals-locks-sample.dbf')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: 'Lock 1, Clachnaharry Sea-Lock', 'sub type': 'Lock', 'location e': '264473', 'location n': '846727' })
  })

  it('places locks from their eastings and northings', () => {
    const [sea] = featuresFromScottishCanals('locks', dbf('scottish-canals-locks-sample.dbf'), AT)
    expect(sea).toMatchObject({ kind: 'lock', name: 'Lock 1, Clachnaharry Sea-Lock', source: { source: 'scottish-canals', sourceId: 'CD-001-005' } })
    expect(sea.at[0]).toBeCloseTo(57.4904, 3)
    expect(sea.at[1]).toBeCloseTo(-4.2626, 3)
  })

  it('keeps canoe landings and landing stages, not pontoons for boats', () => {
    const kept = featuresFromScottishCanals('moorings', dbf('scottish-canals-moorings-sample.dbf'), AT)
    expect(kept.map(f => f.kind)).toEqual(['access', 'access'])
  })
})

describe('Waterways Ireland', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(FX, 'waterways-ireland-sample.json'), 'utf8'))

  it("keeps each lock once, not its waiting jetties, and not bridges", () => {
    const locks = featuresFromWi('infrastructure', sample.infrastructure, AT)
    expect(locks.map(f => f.name)).toEqual(['Lock 10 Grand Canal'])
    expect(locks[0].source.source).toBe('waterways-ireland')
  })

  it('reads carries as portages, put-ins as access, parking for crews; skips trailheads', () => {
    expect(featuresFromWi('access', sample.access, AT).map(f => f.kind)).toEqual(['portage', 'access'])
  })

  it('keeps toilets, water and showers; warnings become hazards with their text', () => {
    expect(featuresFromWi('facilities', sample.facilities, AT).map(f => f.facilities)).toEqual([['toilet']])
    const [w] = featuresFromWi('warnings', sample.warnings, AT)
    expect(w).toMatchObject({ kind: 'hazard', name: 'Beware of strong currents.  West going current up to 6 knots.' })
  })

  it('is marked non-commercial, so it can be dropped in one place', () => {
    expect(SOURCES['waterways-ireland'].nonCommercial).toBe(true)
    expect(SOURCES['scottish-canals'].nonCommercial).toBeUndefined()
  })
})
