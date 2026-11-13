import { describe, it, expect } from 'vitest'
import { areaFrom, inArea, LANDMARK_KINDS, LANDMARK_PROMPT, LANDMARK_VIEW, parseLandmarks } from './landmarks'
import { placeItem } from './look'
import { haversine } from './stations'

const one = (over: Record<string, unknown> = {}) => JSON.stringify({ items: [{
  name: 'white boathouse with green doors', kind: 'boathouse', detail: 'two storeys, green double doors, slate roof',
  box: { x0: 0.2, y0: 0.3, x1: 0.5, y1: 0.6 }, distance: 'mid', sure: true, ...over,
}] })

describe('parseLandmarks', () => {
  it('keeps a well-formed answer', () => {
    expect(parseLandmarks(one())).toEqual([{ name: 'white boathouse with green doors', kind: 'boathouse', detail: 'two storeys, green double doors, slate roof',
      x0: 0.2, y0: 0.3, x1: 0.5, y1: 0.6, distance: 'mid', sure: true }])
  })
  it('an empty list is an answer; something that is not JSON or has no list is not', () => {
    expect(parseLandmarks('{"items":[]}')).toEqual([])
    expect(parseLandmarks('nope')).toBeNull()
    expect(parseLandmarks('{"things":[]}')).toBeNull()
  })
  it('puts a box drawn backwards the right way round and clamps it to the picture', () => {
    expect(parseLandmarks(one({ box: { x0: 0.6, y0: 1.4, x1: 0.1, y1: 0.2 } }))![0]).toMatchObject({ x0: 0.1, y0: 0.2, x1: 0.6, y1: 1 })
  })
  it('a box given in pixels of the 1024×640 picture is scaled, not thrown away', () => {
    expect(parseLandmarks(one({ box: { x0: 410, y0: 200, x1: 614.4, y1: 320 } }))![0]).toMatchObject({ x0: 410 / 1024, y0: 200 / 640, x1: 0.6, y1: 0.5 })
  })
  it('keeps a real thing whose name or detail starts with "No"', () => {
    expect(parseLandmarks(one({ name: 'No 1 Boathouse', detail: 'No readable sign; red brick with arched doors' }))).toHaveLength(1)
  })
  it('drops things without a usable box, a name, or that the model says it did not see', () => {
    expect(parseLandmarks(one({ box: { x0: 0.2, y0: 0.2, x1: 0.2, y1: 0.5 } }))).toEqual([])
    expect(parseLandmarks(one({ box: { x0: 'a' } }))).toEqual([])
    expect(parseLandmarks(one({ name: '  ' }))).toEqual([])
    expect(parseLandmarks(one({ name: 'None visible' }))).toEqual([])
  })
  it('maps unknown words to safe values, and sure only when it says true', () => {
    expect(parseLandmarks(one({ kind: 'castle', distance: 'miles', sure: 'yes' }))![0]).toMatchObject({ kind: 'other', distance: 'mid', sure: false })
    // A kind for a boat or a person isn't a landmark kind.
    expect(parseLandmarks(one({ kind: 'moored-narrowboat' }))![0].kind).toBe('other')
  })
  it('the same thing written twice counts once', () => {
    const twice = JSON.stringify({ items: [JSON.parse(one()).items[0], JSON.parse(one()).items[0]] })
    expect(parseLandmarks(twice)).toHaveLength(1)
  })
})

describe('the prompt', () => {
  it('names every kind the schema allows, and no boat, person or animal kind', () => {
    for (const k of LANDMARK_KINDS) expect(LANDMARK_PROMPT).toContain(k)
    for (const k of ['person', 'angler', 'swan', 'duck', 'moored-narrowboat', 'moored-cruiser', 'moving-narrowboat', 'rowing-boat', 'trees', 'grass-bank']) expect(LANDMARK_KINDS).not.toContain(k)
  })
})

describe('areas', () => {
  it('takes the corners in any order, and refuses a rectangle with no size', () => {
    expect(areaFrom({ lat: 51.47, lng: -0.97 }, { lat: 51.46, lng: -0.99 })).toEqual({ south: 51.46, north: 51.47, west: -0.99, east: -0.97 })
    expect(areaFrom({ lat: 51.47, lng: -0.97 }, { lat: 51.47, lng: -0.99 })).toBeNull()
  })
  it('a spot is in an area on its edges and inside, not outside', () => {
    const a = { south: 51.46, north: 51.47, west: -0.99, east: -0.97 }
    expect(inArea({ lat: 51.465, lng: -0.98 }, a)).toBe(true)
    expect(inArea({ lat: 51.46, lng: -0.99 }, a)).toBe(true)
    expect(inArea({ lat: 51.471, lng: -0.98 }, a)).toBe(false)
  })
})

describe('placing a careful look', () => {
  it('the edge of a 60° view is 30° off its centre, not the 50° of a general view', () => {
    const at = { lat: 51.4676, lng: -0.9822, heading: 0 }
    const p = placeItem(at, 0, 0, { x: 1, distance: 'mid' }, LANDMARK_VIEW.hFov)
    expect(p.bearing).toBeCloseTo(30, 5)
    expect(haversine(at, p)).toBeCloseTo(30, 0)
  })
  it('keeps the pictures 1024×640 with square pixels', () => {
    const ratio = Math.tan((LANDMARK_VIEW.vFov / 2) * Math.PI / 180) / Math.tan((LANDMARK_VIEW.hFov / 2) * Math.PI / 180)
    expect(ratio).toBeCloseTo(640 / 1024, 6)
  })
})
