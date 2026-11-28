import { describe, it, expect } from 'vitest'
import { LOOK, areaStyle, encodeRoads, inAny, isBridge, isTunnel, keepRuns, length, parseWidth, registerRoad, roadStyle, roadsFrom, roadsQuery, simplify, withBox } from './roads'
import type { XZ } from './river'

describe('what Overpass is asked for', () => {
  it('every highway, car park and road area within the distance of the river line', () => {
    expect(roadsQuery([[51.46, -0.97], [51.461, -0.98]], 1060)).toBe('[out:json][timeout:180];(way["highway"](around:1060,51.46000,-0.97000,51.46100,-0.98000);way["amenity"="parking"](around:1060,51.46000,-0.97000,51.46100,-0.98000);way["area:highway"](around:1060,51.46000,-0.97000,51.46100,-0.98000););out geom;')
  })
})

describe('how wide a road is drawn, and as what', () => {
  it('a main road is wider than a residential street, a service lane narrower, a footway thinner still', () => {
    const w = (highway: string, more = {}) => roadStyle({ highway, ...more })!.width
    expect(w('trunk')).toBeGreaterThan(w('primary'))
    expect(w('primary')).toBeGreaterThan(w('residential'))
    expect(w('residential')).toBeGreaterThan(w('service'))
    expect(w('service', { service: 'driveway' })).toBeLessThan(w('service'))
    expect(w('service')).toBeGreaterThan(w('footway'))
    expect(w('footway')).toBeLessThan(2)
    expect(w('primary_link')).toBeLessThan(w('primary'))
  })
  it('takes a believable width tag first, then lanes, then the class', () => {
    expect(roadStyle({ highway: 'residential', width: '7.5' })!.width).toBe(7.5)
    expect(roadStyle({ highway: 'residential', width: '3,5 m' })!.width).toBe(3.5)
    expect(roadStyle({ highway: 'residential', width: '120' })!.width).toBe(5.5) // (not believable: the class's)
    expect(roadStyle({ highway: 'primary', lanes: '4' })!.width).toBeCloseTo(12.8)
    expect(roadStyle({ highway: 'residential', lanes: '1' })!.width).toBe(5.5) // (lanes only widen: a one-lane street still has its kerbs)
    expect(parseWidth('narrow')).toBeNull()
    expect(parseWidth('2 metres')).toBe(2)
  })
  it('tarmac for carriageways, paving for pavements and paved paths, a pale path in the open, gravel for tracks', () => {
    const look = (tags: Record<string, string>) => roadStyle(tags)!.look
    expect(look({ highway: 'primary' })).toBe(LOOK.tarmac)
    expect(look({ highway: 'footway', footway: 'sidewalk' })).toBe(LOOK.paving)
    expect(look({ highway: 'footway' })).toBe(LOOK.path)
    expect(look({ highway: 'cycleway', surface: 'asphalt' })).toBe(LOOK.paving)
    expect(look({ highway: 'pedestrian' })).toBe(LOOK.paving)
    expect(look({ highway: 'track' })).toBe(LOOK.gravel)
    expect(look({ highway: 'track', surface: 'asphalt' })).toBe(LOOK.tarmac)
  })
  it("draws nothing that isn't on the ground: proposed, building sites, platforms, indoors, below ground", () => {
    for (const tags of [{ highway: 'proposed' }, { highway: 'construction' }, { highway: 'platform' }, { highway: 'corridor' }, { highway: 'footway', indoor: 'yes' }, { highway: 'footway', level: '-1' }, { highway: 'pedestrian', area: 'yes' }] as Array<Record<string, string>>) expect(roadStyle(tags)).toBeNull()
  })
  it('a surface car park, a square, a mapped carriageway are paved areas; a multi-storey or underground car park is not', () => {
    expect(areaStyle({ amenity: 'parking' })).toBe(LOOK.tarmac)
    expect(areaStyle({ amenity: 'parking', parking: 'surface' })).toBe(LOOK.tarmac)
    expect(areaStyle({ amenity: 'parking', parking: 'multi-storey' })).toBeNull()
    expect(areaStyle({ amenity: 'parking', parking: 'underground' })).toBeNull()
    expect(areaStyle({ highway: 'pedestrian', area: 'yes' })).toBe(LOOK.paving)
    expect(areaStyle({ 'area:highway': 'primary' })).toBe(LOOK.tarmac)
    expect(areaStyle({ 'area:highway': 'footway' })).toBe(LOOK.paving)
    expect(areaStyle({ 'area:highway': 'traffic_island' })).toBeNull()
  })
  it('knows a bridge and a tunnel', () => {
    expect(isBridge({ bridge: 'yes' })).toBe(true)
    expect(isBridge({ bridge: 'viaduct' })).toBe(true)
    expect(isBridge({ bridge: 'no' })).toBe(false)
    expect(isTunnel({ tunnel: 'yes' })).toBe(true)
    expect(isTunnel({ tunnel: 'building_passage' })).toBe(true)
    expect(isTunnel({ covered: 'yes' })).toBe(true)
    expect(isTunnel({})).toBe(false)
  })
})

describe("Overpass's ways as roads and areas", () => {
  const toXZ = ([lat, lng]: [number, number]): XZ => [(lng + 0.97) * 1e5, (51.46 - lat) * 1e5]
  const g = (pts: Array<[number, number]>) => pts.map(([x, z]) => ({ lat: 51.46 - z / 1e5, lon: -0.97 + x / 1e5 }))
  it('keeps roads and bridges as lines, closed paved ways as areas, and leaves tunnels out', () => {
    const { roads, areas } = roadsFrom([
      { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: g([[0, 0], [10, 0], [20, 0]]) },
      { type: 'way', id: 2, tags: { highway: 'primary', bridge: 'yes' }, geometry: g([[0, 5], [30, 5]]) },
      { type: 'way', id: 3, tags: { highway: 'primary', tunnel: 'yes' }, geometry: g([[0, 9], [30, 9]]) },
      { type: 'way', id: 4, tags: { amenity: 'parking' }, geometry: g([[0, 20], [10, 20], [10, 30], [0, 30], [0, 20]]) },
      { type: 'node', id: 5, tags: { highway: 'crossing' } },
    ], toXZ)
    expect(roads.map((r) => [r.id, r.bridge])).toEqual([[1, false], [2, true]])
    expect(roads[0].line.length).toBe(2) // (straight: the middle point simplified away)
    expect(areas.map((a) => [a.id, a.ring.length, a.look])).toEqual([[4, 4, LOOK.tarmac]])
  })
  it('simplifies a line to within the tolerance, keeping its ends and corners', () => {
    const line: XZ[] = [[0, 0], [5, 0.1], [10, 0], [10, 10]]
    expect(simplify(line, 0.3)).toEqual([[0, 0], [10, 0], [10, 10]])
    expect(simplify(line, 0.05)).toEqual(line)
  })
})

describe('keeping a road where it may go', () => {
  it('cuts it where it crosses what it must keep off, to within a few centimetres', () => {
    const runs = keepRuns([[0, 0], [100, 0]], (x) => x < 40 || x > 60)
    expect(runs.length).toBe(2)
    expect(runs[0][0]).toEqual([0, 0])
    expect(runs[0].at(-1)![0]).toBeCloseTo(40, 0)
    expect(runs[1][0][0]).toBeCloseTo(60, 0)
    expect(runs[1].at(-1)).toEqual([100, 0])
  })
  it('drops what would be left too short, and a road wholly off', () => {
    expect(keepRuns([[0, 0], [100, 0]], (x) => x < 1)).toEqual([])
    expect(keepRuns([[0, 0], [100, 0]], () => false)).toEqual([])
    expect(length(keepRuns([[0, 0], [50, 0], [50, 50]], () => true)[0])).toBe(100)
  })
  it('keeps a road out of a house: inside its footprint, or within the margin of its walls', () => {
    const house = withBox([[10, -5], [20, -5], [20, 5], [10, 5]])
    expect(inAny([house], 15, 0)).toBe(true)
    expect(inAny([house], 25, 0)).toBe(false)
    expect(inAny([house], 21, 0, 1.5)).toBe(true)
    const runs = keepRuns([[0, 0], [40, 0]], (x, z) => !inAny([house], x, z))
    expect(runs.map((r) => [Math.round(r[0][0]), Math.round(r.at(-1)![0])])).toEqual([[0, 10], [20, 40]])
  })
})

describe("finding how far a road is off the lidar's open ground", () => {
  // A street 6 m wide along z = 0 in the lidar, between houses; the map has it 2.5 m south (z = 2.5).
  const open = (x: number, z: number) => Math.abs(z) < 3.5
  it('finds the shift that lays the mapped road back on the open ground', () => {
    const r = registerRoad([[0, 2.5], [60, 2.5]], 6, open)!
    expect(r.shift[1]).toBeCloseTo(-2.5, 0)
    expect(r.after).toBeGreaterThan(r.before)
    expect(r.after).toBe(1)
  })
  it("doesn't move a road already on it", () => {
    expect(registerRoad([[0, 0], [60, 0]], 6, open)!.shift).toEqual([0, 0])
  })
  it("says nothing where the lidar doesn't know", () => {
    expect(registerRoad([[0, 0], [60, 0]], 6, () => null)).toBeNull()
    expect(registerRoad([[0, 0], [2, 0]], 6, open)).toBeNull()
  })
})

describe('the numbers the game reads', () => {
  it('per road its look, width and bridge, then its points in decimetres as steps; per area its look and ring', () => {
    const { roads, areas } = encodeRoads([{ line: [[100, 200], [101.5, 200], [101.5, 197]], width: 5.5, look: LOOK.tarmac, bridge: true }], [{ ring: [[100, 200], [110, 200], [110, 210]], look: LOOK.paving }], [100, 200])
    expect(roads).toEqual([[0, 55, 1, 0, 0, 15, 0, 0, -30]])
    expect(areas).toEqual([[1, 0, 0, 100, 0, 0, 100]])
  })
})
