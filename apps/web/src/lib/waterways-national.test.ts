// The national network (docs/features/waterways-uk-ireland.md): routing that
// keeps to the navigation, snapping and "what's along" on a grid index, the
// route/time split the server and browser share, and the places search.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { featuresAlong } from '@paddlesnitch/waterways/along'
import { mergeFeatures } from '@paddlesnitch/waterways/build'
import { featuresFromAmber, featuresFromIfi, featuresFromSepa } from '@paddlesnitch/waterways/ingest/barriers'
import { readDbf } from '@paddlesnitch/waterways/ingest/dbf'
import { featuresFromAims } from '@paddlesnitch/waterways/ingest/ea-aims'
import { featuresFromUmap } from '@paddlesnitch/waterways/ingest/ea-umap'
import { linksFromWays, osmGateLocks, osmLocks, type OsmWay } from '@paddlesnitch/waterways/ingest/osm'
import { featuresFromScottishCanals } from '@paddlesnitch/waterways/ingest/scottish-canals'
import { featuresFromWi } from '@paddlesnitch/waterways/ingest/waterways-ireland'
import { paddleCost, route, snap } from '@paddlesnitch/waterways/network'
import { buildPlaces, searchPlaces, type Place } from '@paddlesnitch/waterways/places'
import { computePlan, routePlan, timePlan } from '@paddlesnitch/waterways/plan'
import { portageOnRoute, portagesAt, type PublicPortage } from '@paddlesnitch/waterways/portage'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import type { Feature, LatLng, NetLink, RegionDataset } from '@paddlesnitch/waterways/types'
import { coverageLines, levelOf, waterwayCoverage } from '@paddlesnitch/waterways/waterway-coverage'
import { sampleLine } from '@paddlesnitch/waterways/plan-store'
import { portageLines, stopLines } from './plan-ui'

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

describe('Environment Agency asset register (AIMS)', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(FX, 'ea-aims-sample.json'), 'utf8'))

  it('keeps weirs (drawn as lines, placed mid-river) and slipways; skips outfalls and stoplogs', () => {
    const out = featuresFromAims(sample.features, AT)
    expect(out.map(f => f.kind).sort()).toEqual(['slipway', 'weir'])
    const weir = out.find(f => f.kind === 'weir')!
    expect(weir).toMatchObject({ id: 'ea-aims:weir:186679', name: undefined, source: { source: 'ea-aims' } })
    expect(weir.at[0]).toBeCloseTo(53.226, 2)
  })
})

describe('Environment Agency uMap maps', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(FX, 'ea-umap-sample.json'), 'utf8'))

  it('reads Nene locks without their headroom, water points, Elsan and weir warnings; not moorings', () => {
    const out = featuresFromUmap('nene', sample.nene, AT)
    expect(out.map(f => [f.kind, f.name])).toEqual([
      ['lock', 'Abington Lock'], ['lock', 'Alwalton Lock'], ['lock', 'Ashton Lock'],
      ['facility', 'Embankment Water Point'],
      ['facility', 'Ditchford Lock Elsan point'], ['facility', 'Elsan point'],
      ['hazard', 'Ashton Weir'],
    ])
    expect(out[3].facilities).toEqual(['drinking_water'])
    expect(out[4].facilities).toEqual(['elsan'])
  })

  it('turns current notices into hazards, and skips the head and end of navigation markers', () => {
    const out = featuresFromUmap('notices-stour', sample.stour, AT)
    expect(out.map(f => f.name)).toEqual([
      'Notice: Boxted Mills - levels lowered to make repairs',
      'Notice: Bures Mill Downstream Canoe Portage - Closed',
      'Notice: Great Cornard Downstream Portage - Closed',
    ])
    expect(out.every(f => f.kind === 'hazard' && f.source.url?.includes('umap'))).toBe(true)
  })
})

describe('OSM lock chambers (filling gaps)', () => {
  const chamber = (id: number, at: LatLng, tags: Record<string, string>): OsmWay =>
    way(id, [id * 10, id * 10 + 1], [at, [at[0] + 0.0003, at[1]]], { waterway: 'canal', lock: 'yes', ...tags })

  it('one lock per chamber, named from lock_name or a name with "lock" in it', () => {
    const locks = osmLocks([
      chamber(1, [52, -1], { name: 'River Nene', lock_name: 'Islip Lock' }),
      chamber(2, [52.0001, -1], { name: 'River Nene' }),               // the same chamber, drawn twice
      chamber(3, [52.1, -1], { name: 'Cardington Lock' }),
      chamber(4, [52.2, -1], { name: 'River Great Ouse' }),
    ], AT)
    expect(locks.map(l => l.name)).toEqual(['Islip Lock', 'Cardington Lock', undefined])
    expect(locks[0]).toMatchObject({ kind: 'lock', source: { source: 'osm', sourceId: 'way/1' } })
  })

  it('skips boat rollers and private marina locks', () => {
    expect(osmLocks([
      chamber(1, [51.43, -0.32], { lock_name: 'Teddington Lock Boat Rollers' }),
      chamber(2, [51.48, -0.30], { name: 'Brentford Dock Lock', access: 'private' }),
    ], AT)).toEqual([])
  })

  it('makes a lock from a pair of lock gates when no chamber is drawn (the Medway)', () => {
    const gate = (id: number, at: LatLng, tags: Record<string, string> = {}) => ({ id: `node/${id}`, at, tags: { waterway: 'lock_gate', ...tags } })
    const chambers = osmLocks([chamber(9, [51.2508, 0.4466], { name: 'Teston Lock' })], AT)
    const locks = osmGateLocks([
      gate(32336165, [51.194813, 0.278963]), gate(10064659379, [51.194683, 0.279384], { name: 'Town Lock' }),   // Tonbridge: ~33 m apart
      gate(472528923, [51.250738, 0.446575]), gate(472528924, [51.25103, 0.446725]),                           // Teston: chamber already drawn
      gate(1, [51.3, 0.6]),                                                                                       // a lone gate
      { id: 'way/951522045', at: [51.5063, -0.0722], tags: { waterway: 'lock_gate' } },                             // St Katharine Docks,
      { id: 'way/951522046', at: [51.5064, -0.0723], tags: { waterway: 'lock_gate' } },                             // drawn as lines
    ], chambers, AT)
    expect(locks).toEqual([{
      id: 'osm:lock:node/32336165', kind: 'lock', name: 'Town Lock', at: [51.194748, 0.279174],
      source: { source: 'osm', sourceId: 'node/32336165', fetchedAt: AT },
    }])
  })

  it('counts on a route only when the chamber is on the water travelled, not a side cut', () => {
    const line: LatLng[] = [[52, -1], [52, -0.99]]
    const at = (dLat: number): Feature => ({ id: `osm:${dLat}`, kind: 'lock', at: [52 + dLat, -0.995], source: { source: 'osm', fetchedAt: AT } })
    expect(featuresAlong(line, [at(0.0003), at(0.0009)]).map(a => a.item.id)).toEqual(['osm:0.0003'])   // ~33 m in, ~100 m out
  })
})

describe('weirs and waterfalls from the barrier inventories', () => {
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8')).features

  it('SEPA: weirs, and waterfalls as hazards; not culverts or removed barriers', () => {
    const out = featuresFromSepa(read('sepa-obstacles-sample.json'), AT)
    expect(out.map(f => [f.kind, f.name])).toEqual([['hazard', 'Waterfall'], ['weir', undefined]])
    expect(out[0].source).toMatchObject({ source: 'sepa', sourceId: '2062' })
  })

  it('AMBER: weirs and sluices with their name and height to 10 cm; a few mm reads as unknown; no culverts', () => {
    const out = featuresFromAmber(read('amber-sample.json'), AT)
    expect(out.map(f => [f.id, f.name, f.weir?.heightM])).toEqual([
      ['amber:EN_13361_EA', 'Abingdon', 0.5],
      ['amber:EN_1679_EA', undefined, undefined],
      ['amber:EN_12722_EA', undefined, undefined],     // named "Null" in the source
    ])
    expect(stopLines({ feature: out[0], leg: 'out', chainageM: 0, fromPrevM: 0, portage: false, portagesBefore: 0, elapsedS: 0 })).toContain('About 0.5 m high.')
  })

  it('IFI: weirs and sluices as weirs, rock waterfalls as hazards; counted on a route only on the water', () => {
    const out = featuresFromIfi(read('ifi-barriers-sample.json'), AT)
    expect(out.map(f => [f.kind, f.name])).toEqual([['weir', undefined], ['weir', undefined], ['hazard', 'Waterfall']])
    expect(out[0].source.source).toBe('ifi')
    const line: LatLng[] = [[53.4, -8], [53.4, -7.99]]
    const near = (dLat: number): Feature => ({ id: `w${dLat}`, kind: 'weir', at: [53.4 + dLat, -7.995], source: { source: 'ifi', fetchedAt: AT } })
    expect(featuresAlong(line, [near(0.0003), near(0.0015)]).map(a => a.item.id)).toEqual(['w0.0003'])   // ~33 m in, ~170 m out
  })

  it('one weir where two sources map it, keeping the one with a name or height', () => {
    const w = (id: string, source: 'amber' | 'ea-aims', at: LatLng, extra: Partial<Feature> = {}): Feature =>
      ({ id, kind: 'weir', at, source: { source, fetchedAt: AT }, ...extra })
    const merged = mergeFeatures([
      w('aims', 'ea-aims', [52, -1]),
      w('amber', 'amber', [52.0002, -1], { name: 'Mill Weir', weir: { heightM: 1.2 } }),   // ~22 m away
      w('far', 'ea-aims', [52.01, -1]),
    ])
    expect(merged.map(f => f.id).sort()).toEqual(['amber', 'far'])
  })

  it("a lock's own weir folds into the lock; a weir on its own stays a stop", () => {
    const lock: Feature = { id: 'lock', kind: 'lock', name: 'Mill Lock', at: [51.5, -0.995], source: { source: 'crt', fetchedAt: AT } }
    const beside: Feature = { id: 'beside', kind: 'weir', at: [51.5, -0.9945], source: { source: 'amber', fetchedAt: AT } }   // ~35 m on
    const alone: Feature = { id: 'alone', kind: 'weir', name: 'Lone Weir', at: [51.5, -0.98], source: { source: 'amber', fetchedAt: AT } }
    const links = linksFromWays([way(1, [1, 2], [[51.5, -1], [51.5, -0.97]], { boat: 'yes' })])
    const r = routePlan({ links, features: [lock, beside, alone] }, { start: [51.5, -0.999], finish: [51.5, -0.971], shape: 'one_way' })
    if (typeof r === 'string') throw new Error(r)
    expect(r.stops.map(s => s.feature.id)).toEqual(['lock', 'alone'])
  })
})

describe('coverage by waterway', () => {
  const link = (id: string, name: string, from: string, to: string, line: LatLng[], extra: Partial<NetLink> = {}): NetLink =>
    ({ id, name, form: 'inlandRiver', from, to, line, lengthM: Math.round(line.length > 1 ? (line.at(-1)![1] - line[0][1]) * 69_000 : 0), ...extra })
  // A 13.8 km navigation in two pieces, joined by a 140 m lock chamber with a name of its own.
  const nav = [
    link('a', 'River Test', 'n1', 'n2', [[51, 0], [51, 0.1]], { boat: 'yes' }),
    link('lock', 'Test Lock', 'n2', 'n3', [[51, 0.1], [51, 0.102]], { form: 'canal' }),
    link('b', 'River Test', 'n3', 'n4', [[51, 0.102], [51, 0.2]], { boat: 'yes' }),
  ]
  const brook = link('c', 'Little Brook', 'n9', 'n8', [[52, 0], [52, 0.01]])          // 690 m: too short to score
  const unnamed = link('d', '', 'n7', 'n6', [[53, 0], [53, 0.3]])
  const f = (id: string, kind: Feature['kind'], at: LatLng, extra: Partial<Feature> = {}): Feature => ({ id, kind, at, source: { source: 'crt', fetchedAt: AT }, ...extra })

  it('one waterway per name, not split by a lock chamber; short rivers and unnamed water not scored', () => {
    const rows = waterwayCoverage([...nav, brook, unnamed], [])
    expect(rows.map(r => [r.name, r.kind, r.km])).toEqual([['River Test', 'navigation', 13.8]])
  })

  it("counts what's on it, including the lock on its chamber", () => {
    const [row] = waterwayCoverage(nav, [
      f('l', 'lock', [51, 0.101]), f('w', 'weir', [51.0005, 0.05]), f('s', 'slipway', [51, 0.15]),
      f('far', 'access', [51.05, 0.15]),
    ])
    expect(row).toMatchObject({ locks: 1, locksWithSide: 0, weirs: 1, access: 1, crew: 0, sources: ['crt'] })
  })

  it('levels: thin with nothing, some with anything, good only with access, crew and every portage side', () => {
    const base = { km: 20, locks: 0, locksWithSide: 0, weirs: 0, access: 0, crew: 0, facilities: 0 }
    expect(levelOf(base)).toBe('thin')
    expect(levelOf({ ...base, weirs: 3 })).toBe('some')
    expect(levelOf({ ...base, access: 2, crew: 1 })).toBe('good')
    expect(levelOf({ ...base, access: 2, crew: 1, locks: 4, locksWithSide: 3 })).toBe('some')
    expect(levelOf({ ...base, access: 1, crew: 1 })).toBe('some')   // 20 km needs 2 places to get in and out
  })

  it('counts the saved plans that travel each waterway, and puts the most planned first', () => {
    const other = [link('e', 'Kennet', 'm1', 'm2', [[52, 0], [52, 0.3]], { boat: 'yes' })]    // longer than River Test
    const routes: LatLng[][] = [
      [[51, 0.05], [51, 0.15]],                         // along River Test
      [[51.0001, 0.12], [51.0002, 0.18]],                // River Test again
      [[51.01, 0.05]],                                   // ~1.1 km off: travels nothing
    ]
    expect(waterwayCoverage([...nav, ...other], [], undefined, routes).map(r => [r.name, r.plans])).toEqual([['River Test', 2], ['Kennet', 0]])
    expect(waterwayCoverage([...nav, ...other], []).map(r => r.name)).toEqual(['Kennet', 'River Test'])   // no plans: longest first
  })

  it('samples a route about every kilometre, ends kept, rounded, capped', () => {
    const line: LatLng[] = Array.from({ length: 101 }, (_, i) => [51, i * 0.0015])   // ~105 m apart, ~10.5 km
    const s = sampleLine(line)
    expect(s[0]).toEqual([51, 0])
    expect(s.at(-1)).toEqual([51, 0.15])
    expect(s.length).toBeGreaterThanOrEqual(10)
    expect(s.length).toBeLessThanOrEqual(12)
    expect(sampleLine(line, 100, 20).length).toBeLessThanOrEqual(21)
  })

  it('colours the scored water on the map by level', () => {
    const rows = waterwayCoverage(nav, [])
    const lines = coverageLines(nav, rows)
    expect(lines.thin.length).toBe(3)    // all three links of River Test, the lock chamber included
    expect(lines.good).toEqual([])
  })
})

describe('OpenPortage: portage details as met on a route', () => {
  const line: LatLng[] = [[51.5, -1], [51.5, -0.99]]                       // heading east
  const c: PublicPortage = {
    id: 'p1', name: 'Ann', featureId: 'crt:locks:1', at: [51.5, -0.995], licence: 'CC0-1.0', createdAt: AT, updatedAt: AT,
    landings: [[51.5001, -0.9945], [51.5001, -0.9955]],                   // north bank, either order
    notes: 'Steep steps', rollers: true,
  }

  it('the landing reached first is the take-out; banks are looking the way you go', () => {
    const east = portageOnRoute(line, c)
    expect(east.takeOut.at).toEqual([51.5001, -0.9955])
    expect(east.takeOut.bank).toBe('left')                                 // north, heading east
    expect(east.carryM).toBeGreaterThan(60)
    const west = portageOnRoute([...line].reverse(), c)
    expect(west.takeOut.at).toEqual([51.5001, -0.9945])
    expect(west.takeOut.bank).toBe('right')
  })

  it('belongs to its lock by id, or by place when the id changed; hidden ones never show', () => {
    const lock: Feature = { id: 'crt:locks:1', kind: 'lock', at: [51.5, -0.995], source: { source: 'crt', fetchedAt: AT } }
    const moved: Feature = { ...lock, id: 'crt:locks:new-id' }
    expect(portagesAt(lock, [c]).map(x => x.id)).toEqual(['p1'])
    expect(portagesAt(moved, [c]).map(x => x.id)).toEqual(['p1'])
    expect(portagesAt(lock, [{ ...c, hidden: true }])).toEqual([])
    expect(portagesAt({ ...lock, id: 'elsewhere', at: [52, -1] }, [c])).toEqual([])
  })

  it('reads as plain directions, and replaces "side not known" on the stop', () => {
    const p = portageOnRoute(line, c)
    expect(portageLines(p)).toEqual([`Get out on the left bank; back in about ${p.carryM} m on.`, 'Rollers.', '“Steep steps”'])
    const lock: Feature = { id: 'l', kind: 'lock', name: 'Mill Lock', at: [51.5, -0.995], source: { source: 'crt', fetchedAt: AT } }
    const stop = { feature: lock, leg: 'out' as const, chainageM: 0, fromPrevM: 0, portage: true, portagesBefore: 0, elapsedS: 0 }
    expect(stopLines(stop)).toContain('Portage side not known yet.')
    expect(stopLines({ ...stop, portages: [p] })).not.toContain('Portage side not known yet.')
  })

  it('routePlan attaches them to their stop, the right way round on each leg of a return', () => {
    const links = linksFromWays([way(1, [1, 2], [[51.5, -1], [51.5, -0.97]], { boat: 'yes' })])
    const lock: Feature = { id: 'crt:locks:1', kind: 'lock', at: [51.5, -0.995], source: { source: 'crt', fetchedAt: AT } }
    const r = routePlan({ links, features: [lock] }, { start: [51.5, -0.999], finish: [51.5, -0.971], shape: 'return' }, [c])
    if (typeof r === 'string') throw new Error(r)
    const [out, back] = r.stops
    expect(out.portages?.[0].takeOut.bank).toBe('left')
    expect(back.portages?.[0].takeOut.bank).toBe('right')
  })
})
