import { describe, it, expect } from 'vitest'
import { bridges, courseFile, mooringRow, places, routePlaces, sides, widths, type RiverThing } from './course-file'
import type { XZ } from './river'

describe('widths', () => {
  it('takes out a one-sample spike and clamps to the river', () => {
    const e = [50, 50, 50, 8, 50, 50, 50, 300, 50, 50].map((w) => ({ left: w / 2, right: w / 2 }))
    expect(widths(e)).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 50])
    expect(widths([{ left: 5, right: 5 }])).toEqual([20])
    expect(widths([{ left: null, right: 30 }])).toEqual([40]) // no bank found: a middling width
  })
})

const bridge = (s: number, tags: Record<string, string>, name?: string): RiverThing => ({ kind: 'bridge', s, lateral: 0, tags, name })

describe('bridges', () => {
  it('makes one bridge of the decks, roads and paths crossing at one place, under its own name', () => {
    const got = bridges([
      bridge(600, { highway: 'primary', bridge: 'yes' }, 'Caversham Road'),
      bridge(605, { man_made: 'bridge' }, 'Caversham Bridge'),
      bridge(612, { highway: 'footway', bridge: 'yes' }),
      bridge(2000, { railway: 'rail', bridge: 'yes' }, 'Main Line'),
    ], new Map([['Caversham Bridge', { style: 'concrete-arch' }]]))
    expect(got).toEqual([
      { s: 600, name: 'Caversham Bridge', style: 'concrete-arch' },
      { s: 2000, name: 'Main Line', style: 'arch' },
    ])
  })

  it('lays a bridge along its road, which can cross the river at a slant', () => {
    const road = (s: number, tags: Record<string, string>, shape: XZ[], name?: string): RiverThing => ({ ...bridge(s, tags, name), shape })
    const got = bridges([
      road(600, { highway: 'primary', bridge: 'yes' }, [[-10, 40], [0, 0], [12, -45]], 'Caversham Road'),
      road(604, { highway: 'footway', bridge: 'yes' }, [[-14, 38], [-4, 0]]),
      bridge(605, { man_made: 'bridge' }, 'Caversham Bridge'),
    ], new Map())
    // The longest road's two ends.
    expect(got[0].ends).toEqual([[-10, 40], [12, -45]])
  })
})

describe('mooringRow', () => {
  const rand = () => 0.5
  it('fills a stretch of bank nose to tail', () => {
    const row = mooringRow(100, 200, 1, 'cruiser', rand)
    expect(row.length).toBeGreaterThan(5)
    expect(row.every((b) => b.side === 1 && b.kind === 'cruiser' && b.length >= 8 && b.length <= 12)).toBe(true)
    for (let i = 1; i < row.length; i++) expect(row[i].s - row[i - 1].s).toBeGreaterThanOrEqual((row[i].length + row[i - 1].length) / 2)
    expect(row[0].s - row[0].length / 2).toBeGreaterThanOrEqual(90)
    expect(row.at(-1)!.s + row.at(-1)!.length / 2).toBeLessThanOrEqual(212)
  })

  it('puts at least one boat at a single spot', () => {
    expect(mooringRow(500, 500, -1, 'narrowboat', rand)[0]).toMatchObject({ side: -1, kind: 'narrowboat' })
  })
})

describe('courseFile', () => {
  const line: XZ[] = Array.from({ length: 101 }, (_, i) => [0, -i * 10])        // 1 km due north
  const edges = line.map(() => ({ left: 25, right: 25 }))
  // A place is found by its z, and is "the same way" when heading north-ish.
  const place = ([lat]: [number, number], heading: number) => ({ s: lat, same: heading < 90 || heading > 270 })
  const base = { name: 'Test', speedup: 4, warp: 4, start: 50, finish: 950, line, edges, things: [] as RiverThing[], place }

  it('puts a bank seen from the other direction on the other side, and keeps walls', () => {
    const out = courseFile({
      ...base,
      observations: [
        { kind: 'bank', cover: 'park', side: 'left', from: { at: [100, 0], heading: 0 }, to: { at: [300, 0], heading: 0 } },
        { kind: 'bank', cover: 'wild', side: 'left', from: { at: [600, 0], heading: 180 }, to: { at: [400, 0], heading: 180 } },
        { kind: 'wall', side: 'right', from: { at: [700, 0], heading: 0 }, to: { at: [800, 0], heading: 0 } },
      ],
    })
    expect(out.banks).toEqual([{ side: -1, from: 100, to: 300, cover: 'park' }, { side: 1, from: 400, to: 600, cover: 'wild' }])
    expect(out.walls).toEqual([{ side: 1, from: 700, to: 800 }])
    expect(out.credit).toMatch(/OpenStreetMap/)
    expect(out.licence).toMatch(/ODbL/)
  })

  it('keeps nearby buildings, makes those in a stretch of flats tall, and drops far ones', () => {
    const square = (x: number, z: number): XZ[] => [[x, z], [x + 10, z], [x + 10, z - 10], [x, z - 10], [x, z]]
    const out = courseFile({
      ...base,
      observations: [{ kind: 'buildings', style: 'flats', side: 'right', from: { at: [400, 0], heading: 0 }, to: { at: [500, 0], heading: 0 } }],
      things: [
        { kind: 'building', s: 450, lateral: 40, tags: { building: 'yes' }, shape: square(40, -450) },
        { kind: 'building', s: 100, lateral: -40, tags: { building: 'house', 'building:levels': '2' }, shape: square(-50, -100) },
        { kind: 'building', s: 100, lateral: 400, tags: { building: 'yes' }, shape: square(400, -100) },
      ],
    })
    expect(out.buildings.map((b) => [b.kind, b.height])).toEqual([['flats', 12], ['house', 7]])
  })

  it('marks named landmarks for a bespoke model', () => {
    const square: XZ[] = [[40, -450], [50, -450], [50, -460], [40, -460], [40, -450]]
    const out = courseFile({
      ...base, observations: [], styles: { 'Rowing Club': 'rowing-club' },
      things: [{ kind: 'boathouse', name: 'Rowing Club', s: 450, lateral: 40, tags: { building: 'boathouse' }, shape: square }],
    })
    expect(out.buildings[0].style).toBe('rowing-club')
  })

  it('marks an unnamed building for a bespoke model from a point beside it', () => {
    const square = (x: number, z: number): XZ[] => [[x, z], [x + 10, z], [x + 10, z - 10], [x, z - 10], [x, z]]
    const out = courseFile({
      ...base, toXZ: ([lat, lng]) => [lng, -lat],
      observations: [{ kind: 'landmark', style: 'spiral-boathouse', at: [455, 30], heading: 0 }],
      things: [
        { kind: 'building', s: 450, lateral: 40, tags: { building: 'house' }, shape: square(40, -450) },
        { kind: 'building', s: 480, lateral: 40, tags: { building: 'house' }, shape: square(40, -480) },
      ],
    })
    expect(out.buildings.map((b) => b.style)).toEqual(['spiral-boathouse', undefined])
  })

  it('keeps posts in the water where they were seen, and anglers spread along their stretch of bank', () => {
    const out = courseFile({
      ...base, toXZ: ([lat, lng]) => [lng, -lat],
      observations: [
        { kind: 'posts', at: [300, 5], heading: 0, points: [[300, 5], [303, 6]] },
        { kind: 'anglers', side: 'left', count: 3, from: { at: [600, 0], heading: 0 }, to: { at: [700, 0], heading: 0 } },
      ],
    })
    expect(out.posts).toEqual([[5, -300], [6, -303]])
    expect(out.anglers).toHaveLength(3)
    expect(out.anglers!.every((a) => a.side === -1 && a.s >= 600 && a.s <= 700)).toBe(true)
    expect(out.anglers!.map((a) => a.s)).toEqual([...out.anglers!.map((a) => a.s)].sort((a, b) => a - b))
  })

  it('keeps a footpath along the bank as its line of points, for the portage run and for trees to keep off', () => {
    const out = courseFile({
      ...base, toXZ: ([lat, lng]) => [lng, -lat],
      observations: [{ kind: 'path', at: [300, 30], heading: 0, points: [[300, 30], [340, 31], [380, 30]] }],
    })
    expect(out.paths).toEqual([[[30, -300], [31, -340], [30, -380]]])
    expect(courseFile({ ...base, observations: [] }).paths).toBeUndefined()
  })

  it('keeps a feature where it was seen, by its style, for its own model', () => {
    const out = courseFile({
      ...base, toXZ: ([lat, lng]) => [lng, -lat],
      observations: [{ kind: 'feature', style: 'mailbox', at: [300, 22], heading: 0 }],
    })
    expect(out.features).toEqual([{ style: 'mailbox', at: [22, -300] }])
    expect(courseFile({ ...base, observations: [] }).features).toBeUndefined()
  })

  it('keeps how a wall is built, where the frames showed it', () => {
    const out = courseFile({ ...base, observations: [{ kind: 'wall', style: 'brick', side: 'left', from: { at: [700, 0], heading: 0 }, to: { at: [800, 0], heading: 0 } }] })
    expect(out.walls).toEqual([{ side: -1, from: 700, to: 800, style: 'brick' }])
  })

  it('gives the houses along a stretch of bank the style the frames showed', () => {
    const square = (x: number, z: number): XZ[] => [[x, z], [x + 10, z], [x + 10, z - 10], [x, z - 10], [x, z]]
    const out = courseFile({
      ...base,
      observations: [{ kind: 'buildings', style: 'clapboard', side: 'left', from: { at: [400, 0], heading: 0 }, to: { at: [500, 0], heading: 0 } }],
      things: [
        { kind: 'building', s: 450, lateral: -40, tags: { building: 'house' }, shape: square(-50, -450) },
        { kind: 'building', s: 450, lateral: 40, tags: { building: 'house' }, shape: square(40, -450) }, // across the river
        { kind: 'building', s: 700, lateral: -40, tags: { building: 'house' }, shape: square(-50, -700) }, // further up
      ],
    })
    expect(out.buildings.map((b) => [b.kind, b.style])).toEqual([['house', 'clapboard'], ['house', undefined], ['house', undefined]])
  })

  it('moors one boat of a given length, paint and crew where one was seen', () => {
    const out = courseFile({ ...base, observations: [{ kind: 'moorings', side: 'right', boats: 'narrowboat', length: 18, paint: 'maroon', crew: 'statues', at: [300, 0], heading: 0 }] })
    expect(out.moorings).toEqual([{ s: 300, length: 18, side: 1, kind: 'narrowboat', paint: 'maroon', crew: 'statues' }])
  })

  it('moors tatty boats as their own kind', () => {
    const out = courseFile({ ...base, observations: [{ kind: 'moorings', side: 'right', boats: 'tatty', from: { at: [300, 0], heading: 0 }, to: { at: [360, 0], heading: 0 } }] })
    expect(out.moorings.length).toBeGreaterThan(3)
    expect(out.moorings.every((m) => m.kind === 'tatty' && m.side === 1)).toBe(true)
  })
})

describe('places', () => {
  const thing = (name: string, s: number, lateral = 20): RiverThing => ({ kind: 'island', name, s, lateral, tags: {} })
  it('names landmarks where the river comes nearest, in course order, inside the race', () => {
    const things = [thing('Bridge', 400), thing('Bridge', 410), thing('Island', 120), thing('Far away', 300, 900), thing('Weir', 1200)]
    expect(places(things, ['Bridge', { name: 'Island', label: 'The island' }, 'Far away', 'Missing', { name: 'Weir', label: 'Lock ahead' }], [50, 950]))
      .toEqual([{ s: 120, name: 'The island' }, { s: 400, name: 'Bridge' }, { s: 920, name: 'Lock ahead' }])
  })
})

describe('birds', () => {
  it('puts each flock beside the landmark it is named for', () => {
    const out = courseFile({
      name: 'Test', speedup: 4, warp: 4, start: 50, finish: 950,
      line: Array.from({ length: 101 }, (_, i): XZ => [0, -i * 10]), edges: Array.from({ length: 101 }, () => ({ left: 25, right: 25 })),
      things: [{ kind: 'boathouse', name: 'Rowing Club', s: 300, lateral: -30, tags: {} }],
      observations: [], place: () => ({ s: 0, same: true }),
      birds: [{ near: 'Rowing Club', count: 10, spread: 100 }, { near: 'Nowhere', count: 3, spread: 50 }],
    })
    expect(out.birds).toEqual([{ s: 300, count: 10, spread: 100 }])
  })
})

describe('a route', () => {
  // Up a straight reach and back down it, 10 m to the right of the way up.
  const up = Array.from({ length: 101 }, (_, i): XZ => [0, -i * 10])
  const line: XZ[] = [...up, ...up.slice().reverse().map(([x, z]): XZ => [x + 10, z])]

  it('names a landmark once each time it goes by, as you come up to it', () => {
    const club = { name: 'Club', shape: [[-30, -500], [-30, -540]] as XZ[] }
    const out = routePlaces([club], ['Club', { name: 'Missing', label: 'x' }], line, [0, 2000])
    expect(out.map((p) => p.name)).toEqual(['Club', 'Club'])
    expect(out[0].s).toBeGreaterThan(300)
    expect(out[0].s).toBeLessThan(500)
    expect(out[1].s).toBeGreaterThan(1000)
  })

  it('keeps the open water each side, filling gaps and smoothing out spikes', () => {
    const edges = [{ left: 5, right: 20 }, { left: 5, right: null }, { left: 1, right: 20 }, { left: 5, right: 20 }, { left: 5, right: 20 }]
    expect(sides(edges)).toEqual({ left: [5, 5, 5, 5, 5], right: [20, 20, 20, 20, 20] })
  })
})

