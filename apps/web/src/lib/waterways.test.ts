// River planner domain (@paddlesnitch/waterways). Fixtures in
// src/tests/fixtures/waterways are trimmed real responses from each source.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { haversine } from '@paddlesnitch/timing/geo'
import { featuresAlong } from '@paddlesnitch/waterways/along'
import { buildRegion, lockKey } from '@paddlesnitch/waterways/build'
import { coverageSummary, lockCoverage } from '@paddlesnitch/waterways/coverage'
import { featuresFromCrt } from '@paddlesnitch/waterways/ingest/crt'
import { linksFromOverpass, networkQuery, osmElementsFromOverpass, osmPortageWaysFromOverpass, withPortageEnds } from '@paddlesnitch/waterways/ingest/osm'
import { osmPortages, type PublicPortage } from '@paddlesnitch/waterways/portage'
import { crewFromGuide, guidePaths, locksFromThamesPage } from '@paddlesnitch/waterways/ingest/thames'
import { cumulative, project, simplify, slice } from '@paddlesnitch/waterways/line'
import { reverseRoute, route, snap } from '@paddlesnitch/waterways/network'
import { enToLatLng, gridRefToEN, gridRefToLatLng } from '@paddlesnitch/waterways/osgb'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import type { Feature, LatLng, NetLink } from '@paddlesnitch/waterways/types'

const FX = path.join(__dirname, '../tests/fixtures/waterways')
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'))
const AT = '2026-10-11T00:00:00.000Z'

describe('OS grid → WGS84', () => {
  it('reads letter grid references at every precision', () => {
    expect(gridRefToEN('SU 72735 73533')).toEqual([472735, 173533])
    expect(gridRefToEN('SU7273573533')).toEqual([472735, 173533])
    expect(gridRefToEN('TQ 1077 6858')).toEqual([510770, 168580])
    expect(gridRefToEN('NN 166 712')).toEqual([216600, 771200])
    expect(gridRefToEN('XX 1 2')).toBeNull()
    expect(gridRefToEN('SU 123')).toBeNull()
  })

  it('matches CRT points published with both eastings/northings and WGS84 to within 10 m', () => {
    // Canal & River Trust towpath access points carry EASTING/NORTHING and an
    // Esri-projected WGS84 geometry — an independent check on our transform.
    const pairs: [number, number, LatLng][] = [
      [397829.65, 290328.08, [52.51083867466011, -2.033408467708139]],
      [427152.14, 265581.15, [52.28770139809024, -1.6033627815586908]],
      [423782.4, 163121.49, [51.36666277535078, -1.659769740980191]],
    ]
    for (const [e, n, expected] of pairs) expect(haversine(enToLatLng(e, n), expected)).toBeLessThan(10)
  })

  it("puts Blake's Lock on the Kennet in Reading, not somewhere else", () => {
    const at = gridRefToLatLng('SU 72735 73533')!
    expect(at[0]).toBeCloseTo(51.4566, 2)
    expect(at[1]).toBeCloseTo(-0.9581, 2)
  })
})

describe('line helpers', () => {
  const line: LatLng[] = [[51.5, -1.0], [51.5, -0.99], [51.51, -0.99]]

  it('projects a point onto the nearest segment', () => {
    const pr = project(line, [51.5005, -0.995])
    expect(pr.dist).toBeGreaterThan(50)
    expect(pr.dist).toBeLessThan(60)
    expect(pr.along).toBeCloseTo(cumulative(line)[1] / 2, -1)
  })

  it('slices between two distances, and backwards when reversed', () => {
    const total = cumulative(line)[2]
    const fwd = slice(line, 100, total - 100)
    const back = slice(line, total - 100, 100)
    expect(back).toEqual([...fwd].reverse())
    expect(fwd).toContainEqual(line[1])
  })

  it('simplifies away points that add nothing, keeping the ends', () => {
    const straight: LatLng[] = [[51.5, -1.0], [51.5, -0.995], [51.5, -0.99]]
    expect(simplify(straight, 1)).toEqual([straight[0], straight[2]])
  })
})

describe('network routing', () => {
  // Two links meeting at node B, plus a far-off ditch C–D that isn't connected.
  const links: NetLink[] = [
    { id: 'ab', name: 'Canal', form: 'canal', from: 'A', to: 'B', line: [[51.5, -1.0], [51.5, -0.99]], lengthM: 0 },
    { id: 'bc', name: 'River', form: 'inlandRiver', from: 'B', to: 'C', line: [[51.5, -0.99], [51.51, -0.99]], lengthM: 0 },
    { id: 'xy', name: 'Ditch', form: 'inlandRiver', from: 'X', to: 'Y', line: [[52.0, -1.0], [52.0, -0.99]], lengthM: 0 },
  ].map(l => ({ ...l, lengthM: cumulative(l.line as LatLng[])[1] })) as NetLink[]

  it('routes across a junction between two clicks', () => {
    const r = route(links, snap(links, [51.5001, -0.998])!, snap(links, [51.508, -0.9899])!)!
    expect(r.legs.map(l => l.linkId)).toEqual(['ab', 'bc'])
    expect(r.line[0][1]).toBeCloseTo(-0.998, 3)
    expect(r.lengthM).toBeCloseTo(cumulative(r.line)[r.line.length - 1], -1)
  })

  it('routes along a single link without visiting the network', () => {
    const r = route(links, snap(links, [51.5, -0.998])!, snap(links, [51.5, -0.992])!)!
    expect(r.legs).toHaveLength(1)
    expect(r.lengthM).toBeCloseTo(417, -1)
  })

  it('returns null when the two clicks are on water that never meets', () => {
    expect(route(links, snap(links, [51.5, -0.995])!, snap(links, [52.0, -0.995])!)).toBeNull()
  })

  it('a return trip is the same water the other way', () => {
    const r = route(links, snap(links, [51.5001, -0.998])!, snap(links, [51.508, -0.9899])!)!
    const back = reverseRoute(r)
    expect(back.line).toEqual([...r.line].reverse())
    expect(back.lengthM).toBe(r.lengthM)
  })

  it('builds links from Overpass ways split at every junction (Kennet mouth, Reading)', () => {
    const net = linksFromOverpass(fixture('osm-ways-sample.json').elements)
    // A side channel joining the middle of another way must create a junction there.
    const nodes = new Map<string, number>()
    for (const l of net) for (const n of [l.from, l.to]) nodes.set(n, (nodes.get(n) ?? 0) + 1)
    expect([...nodes.values()].some(c => c >= 3)).toBe(true)
    const r = route(net, snap(net, [51.4515, -0.9705])!, snap(net, [51.4620, -0.9420])!)
    expect(r).not.toBeNull()
    expect(new Set(r!.legs.map(l => l.name))).toEqual(new Set(['River Kennet', 'River Thames']))
  })

  it('escapes names in the Overpass query', () => {
    expect(networkQuery([51, -2, 52, -1], ['Kennet and Avon Canal'])).toContain('^Kennet and Avon Canal$')
    expect(networkQuery([51, -2, 52, -1], ["Wilts & Berks"])).toContain('Wilts \\\\& Berks')
  })
})

describe('features along a route', () => {
  const line: LatLng[] = [[51.5, -1.0], [51.5, -0.98]]   // west → east
  const f = (id: string, kind: Feature['kind'], at: LatLng): Feature => ({ id, kind, at, source: { source: 'curated', fetchedAt: AT } })

  it('orders by distance from the start and drops what is too far away', () => {
    const items = [f('b', 'lock', [51.5, -0.985]), f('a', 'lock', [51.5, -0.995]), f('far', 'facility', [51.505, -0.99])]
    expect(featuresAlong(line, items).map(a => a.item.id)).toEqual(['a', 'b'])
  })

  it('says which bank a point is on, and flips it on the way back', () => {
    const north = f('n', 'crew_point', [51.5005, -0.99])
    expect(featuresAlong(line, [north])[0].bank).toBe('left')     // heading east, north is on the left
    expect(featuresAlong([...line].reverse(), [north])[0].bank).toBe('right')
  })
})

describe('Canal & River Trust ingest', () => {
  it('reads locks with their CRT id and name', () => {
    const locks = featuresFromCrt('locks', fixture('crt-locks.geojson').features, AT)
    expect(locks[0]).toMatchObject({ id: 'crt:locks:KA-054-002', kind: 'lock', name: 'Lock 63, Beech Grove Lock', source: { source: 'crt', sourceId: 'KA-054-002' } })
    expect(locks[0].at).toEqual([51.367324, -1.611336])
  })

  it('reads facility flags', () => {
    const [tyle] = featuresFromCrt('facilities', fixture('crt-facilities.geojson').features, AT)
    expect(tyle.name).toBe('Sanitary Station, Tyle Mill')
    expect(tyle.facilities).toEqual(expect.arrayContaining(['toilet', 'drinking_water', 'elsan', 'pump_out']))
  })

  it('turns towpath access points into crew points with how to get on the towpath', () => {
    const [bruce] = featuresFromCrt('towpathAccess', fixture('crt-towpath.geojson').features, AT)
    expect(bruce.kind).toBe('crew_point')
    expect(bruce.name).toBe('Towpath access: Bruce Tunnel')
    expect(bruce.crew?.directions).toBe('Towpath access point — steps access, 3 m wide.')
  })
})

describe('EA Thames ingest', () => {
  const body = fixture('thames-locks.json').details.body
  const locks = locksFromThamesPage(body, AT)
  const byName = (n: string) => locks.find(l => l.name === n)!

  it('reads every lock on the page', () => {
    expect(locks).toHaveLength(45)
    expect(byName('St John’s Lock')).toBeDefined()
    expect(byName('Teddington Lock')).toBeDefined()
  })

  it('reads locks whose grid reference is labelled per chamber (Sunbury, Teddington)', () => {
    expect(byName('Sunbury Lock').lock?.gridRef).toBe('TQ 10964 68544')
    expect(byName('Teddington Lock').lock?.gridRef).toBe('TQ 16579 71652')
  })

  it('reads postcode, facilities and current notices', () => {
    const shiplake = byName('Shiplake Lock')
    expect(shiplake.lock?.postcode).toBe('RG9 3NA')
    expect(shiplake.lock?.facilities).toEqual(expect.arrayContaining(['card_payment', 'toilet', 'drinking_water', 'elsan', 'electric_charging']))
    expect(byName('Marsh Lock').lock?.notice).toMatch(/Marsh Horse Bridge .* closed/)
    expect(byName('Blakes Lock').lock?.facilities).toEqual([])
    expect(byName('Blakes Lock').source.url).toBe('https://www.gov.uk/guidance/river-thames-locks-and-facilities-for-boaters#blakes-river-kennet')
  })

  it('does not list a facility that is closed or out of use', () => {
    expect(byName('Shiplake Lock').lock?.facilities).not.toContain('pump_out')                // "sewage pump-out - currently closed"
    expect(byName('Molesey Lock').lock?.facilities).toContain('drinking_water')                // the bulk water point still works
    expect(locksFromThamesPage(body.replace(/bulk supply water point/g, 'x'), AT)
      .find(l => l.name === 'Molesey Lock')!.lock?.facilities).not.toContain('drinking_water') // the tap is "currently out of use"
  })

  it('reads how a crew gets to a lock and where to park from the site guides', () => {
    expect(guidePaths(fixture('thames-guides.json'))).toContainEqual(['Cookham', '/government/publications/river-thames-lock-and-weir-fishing-site-guides/cookham-lock-and-weir-fishing-site-guide'])
    const crew = crewFromGuide(fixture('thames-guide-cookham.json').details.body)
    expect(crew.postcode).toBe('SL6 9SR')
    expect(crew.directions).toMatch(/^From the A4094, turn east onto Odney Lane/)
    expect(crew.directions).not.toMatch(/fish/)
    expect(crew.parking).toMatch(/park on the roadside in Odney Lane/)
  })
})

describe('region build and coverage', () => {
  const link: NetLink = { id: 'l', name: 'River Thames', form: 'inlandRiver', from: 'A', to: 'B', line: [[51.5, -1.0], [51.5, -0.98]], lengthM: 1390 }
  const lock = (id: string, source: Feature['source']['source'], at: LatLng, extra: Partial<Feature> = {}): Feature =>
    ({ id, kind: 'lock', name: 'Cookham Lock', at, source: { source, fetchedAt: AT }, ...extra })

  it('keeps one record when CRT and EA both map the same lock, preferring the one with more detail', () => {
    const ds = buildRegion({
      region: 't', bbox: [51, -2, 52, 0], builtAt: AT, links: [link], osm: [],
      features: [lock('crt', 'crt', [51.5, -0.99]), lock('ea', 'ea-thames-locks', [51.5002, -0.99], { lock: { postcode: 'SL6 9SR', facilities: [] } })],
    })
    expect(ds.features.map(f => f.id)).toEqual(['ea'])
  })

  it('attaches site-guide crew detail to the matching lock and drops points far from the water', () => {
    const ds = buildRegion({
      region: 't', bbox: [51, -2, 52, 0], builtAt: AT, links: [link],
      features: [lock('ea', 'ea-thames-locks', [51.5, -0.99]), lock('far', 'crt', [51.6, -0.99])],
      osm: [{ id: 'node/1', at: [51.5003, -0.99], tags: { amenity: 'parking' } }, { id: 'node/2', at: [51.7, -0.99], tags: { amenity: 'parking' } }],
      crewByLock: { cookham: { parking: 'Roadside in Odney Lane' } },
    })
    expect(ds.features.map(f => f.id)).toEqual(['ea'])
    expect(ds.features[0].crew?.parking).toBe('Roadside in Odney Lane')
    expect(ds.osm.map(o => o.id)).toEqual(['node/1'])
  })

  it('normalises lock names from both sources to the same key', () => {
    expect(lockKey('Cookham Lock')).toBe('cookham')
    expect(lockKey('Lock 63, Beech Grove Lock')).toBe('beech grove')
    expect(lockKey('Lock 85A, Garston Lock')).toBe('garston')
  })

  it('reports an unknown portage side as unknown — never guessed', () => {
    const along = featuresAlong(link.line, [lock('ea', 'ea-thames-locks', [51.5, -0.99])])
    const [row] = lockCoverage(along, [])
    expect(row.known.portageSide).toBe(false)
    expect(coverageSummary([row]).portageSide).toBe(0)
  })

  it('counts crew access and parking from nearby towpath access points and OSM car parks', () => {
    const crew: Feature = { id: 'c', kind: 'crew_point', at: [51.5005, -0.991], source: { source: 'crt', fetchedAt: AT } }
    const along = featuresAlong(link.line, [lock('ea', 'ea-thames-locks', [51.5, -0.99]), crew])
    const [row] = lockCoverage(along, [{ id: 'way/9', at: [51.501, -0.99], tags: { amenity: 'parking' } }])
    expect(row.known.crewAccess).toBe(true)
    expect(row.known.parking).toBe(true)
    expect(row.sources).toEqual(expect.arrayContaining(['ea-thames-locks', 'crt', 'osm']))
  })

  it('counts a paddler’s landings at a lock as its portage side, take-out, put-in and carry, credited to them', () => {
    const along = featuresAlong(link.line, [lock('ea', 'ea-thames-locks', [51.5, -0.99])])
    const landings: PublicPortage = {
      id: 'p1', name: 'Ann', featureId: 'ea', at: [51.5, -0.99], landings: [[51.5003, -0.9915], [51.5003, -0.9885]],
      licence: 'CC0-1.0', createdAt: AT, updatedAt: AT,
    }
    const [row] = lockCoverage(along, [], [landings])
    expect(row.known).toMatchObject({ portageSide: true, takeOut: true, putIn: true, carry: true })
    expect(row.sources).toContain('contribution')
    expect(lockCoverage(along, [], [{ ...landings, hidden: true }])[0].known.portageSide).toBe(false)
    // Feature ids change between rebuilds: one about a lock still counts by place.
    expect(lockCoverage(along, [], [{ ...landings, featureId: 'gone' }])[0].known.portageSide).toBe(true)
  })

  it('counts a portage path mapped in OpenStreetMap at a lock, credited to OpenStreetMap', () => {
    const along = featuresAlong(link.line, [lock('ea', 'ea-thames-locks', [51.5, -0.99])])
    const path = osmPortageWaysFromOverpass([
      { type: 'way', id: 7, nodes: [1, 2, 3], geometry: [{ lat: 51.5003, lon: -0.9915 }, { lat: 51.5004, lon: -0.99 }, { lat: 51.5003, lon: -0.9885 }], tags: { portage: 'yes' } },
    ])
    expect(path).toEqual([{ id: 'way/7', at: [51.5004, -0.99], tags: { portage: 'yes' }, ends: [[51.5003, -0.9915], [51.5003, -0.9885]] }])
    // No OSM points passed: the credit and the carry can only come from the landings.
    const [row] = lockCoverage(along, [], osmPortages(path))
    expect(row.known).toMatchObject({ portageSide: true, takeOut: true, putIn: true, carry: true })
    expect(row.sources).toContain('osm')
    expect(row.sources).not.toContain('contribution')
  })

  it('keeps only tagged portage ways that have a geometry, ends and all', () => {
    expect(osmPortageWaysFromOverpass([
      { type: 'way', id: 1, nodes: [], geometry: [], tags: { portage: 'yes' } },
      { type: 'way', id: 2, nodes: [1, 2], geometry: [{ lat: 51.5, lon: -1 }, { lat: 51.501, lon: -1 }] },
      { type: 'node', id: 3, lat: 51.5, lon: -1, tags: { portage: 'yes' } },
      { type: 'way', id: 4, center: { lat: 51.5, lon: -1 }, tags: { portage: 'yes' } },
    ])).toEqual([])
    const [one] = osmPortageWaysFromOverpass([{ type: 'way', id: 5, nodes: [1], geometry: [{ lat: 51.5, lon: -1 }], tags: { portage: 'yes' } }])
    expect(one.ends).toEqual([[51.5, -1], [51.5, -1]])
    expect(osmPortages([one])).toEqual([])   // no length: steps, not a carry
  })

  it('swaps a portage way’s centre point for the copy with its ends, once', () => {
    const centre = { id: 'way/7', at: [51.5004, -0.99] as LatLng, tags: { portage: 'yes' } }
    const ended = { ...centre, ends: [[51.5003, -0.9915], [51.5003, -0.9885]] as [LatLng, LatLng] }
    const parking = { id: 'way/8', at: [51.5, -0.99] as LatLng, tags: { amenity: 'parking' } }
    expect(withPortageEnds([centre, parking], [ended])).toEqual([parking, ended])
  })

  it('reads OSM points at a node or at a way’s centre', () => {
    const els = osmElementsFromOverpass([
      { type: 'node', id: 1, lat: 51.5, lon: -1, tags: { waterway: 'lock_gate' } },
      { type: 'way', id: 2, center: { lat: 51.6, lon: -1.1 }, tags: { amenity: 'parking' } },
      { type: 'node', id: 3, lat: 51.5, lon: -1 },   // untagged: skipped
    ])
    expect(els).toEqual([
      { id: 'node/1', at: [51.5, -1], tags: { waterway: 'lock_gate' } },
      { id: 'way/2', at: [51.6, -1.1], tags: { amenity: 'parking' } },
    ])
  })
})

describe('the built Devizes → Westminster dataset (packages/waterways/data/dw.json)', () => {
  const ds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8'))
  const check = REGIONS.dw.check!
  const r = route(ds.links, snap(ds.links, check.start)!, snap(ds.links, check.finish)!)!
  const locks = featuresAlong(r.line, ds.features).filter(a => a.item.kind === 'lock')

  it('routes the whole way, about 125 miles', () => {
    expect(r).not.toBeNull()
    expect(r.lengthM / 1000).toBeGreaterThan(check.expectKm - 3)
    expect(r.lengthM / 1000).toBeLessThan(check.expectKm + 3)
  })

  it('finds every Kennet & Avon lock from 51 to 106, Blake’s, and the Thames locks to Teddington', () => {
    const names = locks.map(l => l.item.name)
    const numbered = names.map(n => n?.match(/^Lock (\d+)/)?.[1]).filter(Boolean).map(Number)
    expect(numbered).toEqual(Array.from({ length: 56 }, (_, i) => 51 + i))
    expect(names).toEqual(expect.arrayContaining(['Blakes Lock', 'Sonning Lock', 'Boulters Lock', 'Sunbury Lock', 'Teddington Lock']))
    expect(locks).toHaveLength(77)
  })

  it('meets the locks in travel order', () => {
    const order = ['Lock 51, Wootton Rivers', 'Blakes Lock', 'Sonning Lock', 'Teddington Lock']
    const idx = order.map(n => locks.findIndex(l => l.item.name === n))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })
})
