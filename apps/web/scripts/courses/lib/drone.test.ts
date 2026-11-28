import { describe, it, expect } from 'vitest'
import { fieldOfView, frameTarget, groundHit, parseDroneLook, pickShots, placeDroneItem, rayThrough, takeoffGround, type Candidate } from './drone'

const flat = (h: number) => () => h
const close = (a: number[], b: number[], d = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(d)))

describe('fieldOfView', () => {
  it('24 mm on a 16:9 frame is about 72° by 44°; zooming in narrows it', () => {
    const v = fieldOfView(24, 3840, 2160)
    expect(v.h).toBeCloseTo(71.6, 1)
    expect(v.v).toBeCloseTo(44.0, 0)
    expect(fieldOfView(48, 3840, 2160).h).toBeLessThan(40)
  })
})

describe('rayThrough', () => {
  const fov = { h: 90, v: 90 }
  it("the middle of the picture is the camera's own direction", () => {
    close(rayThrough({ pitch: 0, yaw: 0 }, fov, 0.5, 0.5), [0, 1, 0])
    close(rayThrough({ pitch: -90, yaw: 0 }, fov, 0.5, 0.5), [0, 0, -1])
    close(rayThrough({ pitch: 0, yaw: 90 }, fov, 0.5, 0.5), [1, 0, 0])
  })
  it('the right edge is to the right, the top up, and straight down the top of the picture is ahead', () => {
    close(rayThrough({ pitch: 0, yaw: 0 }, fov, 1, 0.5), [1, 1, 0]) // tan 45° = 1
    close(rayThrough({ pitch: 0, yaw: 0 }, fov, 0.5, 0), [0, 1, 1])
    close(rayThrough({ pitch: -90, yaw: 0 }, fov, 0.5, 0), [0, 1, -1])
  })
})

describe('groundHit', () => {
  it('45° down from 50 m meets flat ground 50 m away (game z is south, so north is -z)', () => {
    const hit = groundHit([10, 20], 50, [0, 1, -1], flat(0), 0)!
    expect(hit.range).toBeCloseTo(50, 6)
    expect(hit.x).toBeCloseTo(10, 6)
    expect(hit.z).toBeCloseTo(-30, 6)
  })
  it('a rise in the ground stops the ray sooner', () => {
    const bank = (x: number) => (x > 30 ? 10 : 0)
    const hit = groundHit([0, 0], 50, [1, 0, -1], bank, 0)!
    expect(hit.range).toBeCloseTo(40, 0)
  })
  it('straight down is the point below; at or above the horizon there is no ground', () => {
    expect(groundHit([5, 5], 40, [0, 0, -1], flat(0), 0)).toEqual({ x: 5, z: 5, range: 0 })
    expect(groundHit([0, 0], 40, [0, 1, 0], flat(0), 0)).toBeNull()
    expect(groundHit([0, 0], 40, [0, 1, -0.01], flat(0), 0)).toBeNull() // 4 km out: past MAX_RANGE
  })
  it('uses the fallback where the ground has no value', () => {
    const hit = groundHit([0, 0], 50, [0, 1, -1], () => null, 10)!
    expect(hit.range).toBeCloseTo(40, 6)
  })
})

describe('takeoffGround', () => {
  it('is the ground under the lowest moment when the drone came down near take-off height', () => {
    const g = (x: number) => (x < 0 ? 4 : 1)
    expect(takeoffGround([{ alt: 60, at: [-10, 0] }, { alt: 1.2, at: [-5, 0] }, { alt: 30, at: [5, 0] }], g, 1.5)).toBe(4)
  })
  it('falls back when every moment was high, or the ground there is unknown', () => {
    expect(takeoffGround([{ alt: 60, at: [0, 0] }], flat(4), 1.5)).toBe(1.5)
    expect(takeoffGround([{ alt: 0, at: [0, 0] }], () => null, 1.5)).toBe(1.5)
  })
})

describe('frameTarget', () => {
  const fov = { h: 70, v: 40 }
  it('is where the middle of the picture lands', () => {
    const t = frameTarget([0, 0], 100, { pitch: -45, yaw: 90 }, fov, flat(0), 0)!
    close(t, [100, 0], 1e-3)
  })
  it('looking level, it uses a lower part of the picture; looking up, nothing', () => {
    const t = frameTarget([0, 0], 30, { pitch: 0, yaw: 0 }, fov, flat(0), 0)!
    expect(t[1]).toBeLessThan(0) // north of the drone
    expect(frameTarget([0, 0], 30, { pitch: 30, yaw: 0 }, fov, flat(0), 0)).toBeNull()
  })
})

describe('pickShots', () => {
  const all = () => true
  it('keeps a frame each time what the camera looks at has moved on, coarse first then finer', () => {
    // Looking at a point that moves 10 m a second along x.
    const cands: Candidate[] = Array.from({ length: 13 }, (_, t) => ({ t, yaw: 90, target: [t * 10, 0] }))
    const s = pickShots(cands, [60, 30], all)
    expect(s.filter((x) => x.level === 0).map((x) => x.t)).toEqual([0, 6, 12])
    expect(s.filter((x) => x.level === 1).map((x) => x.t)).toEqual([3, 9])
    expect(new Set(s.map((x) => x.n)).size).toBe(s.length)
  })
  it('a hovering drone turning round gets a frame per direction, not one per second', () => {
    const cands: Candidate[] = Array.from({ length: 20 }, (_, t) => ({ t, yaw: t < 10 ? 0 : 180, target: [0, 0] }))
    expect(pickShots(cands, [60], all).map((x) => x.t)).toEqual([0, 10])
  })
  it('never keeps frames that look at nothing or away from the river, nor two within minGap seconds', () => {
    const cands: Candidate[] = [
      { t: 0, yaw: 0, target: null },
      { t: 1, yaw: 0, target: [1000, 0] },
      { t: 2, yaw: 0, target: [0, 0] },
      { t: 3, yaw: 90, target: [0, 0] },
    ]
    expect(pickShots(cands, [60], (p) => p[0] < 500).map((x) => x.t)).toEqual([2])
  })
})

describe('parseDroneLook', () => {
  const item = { kind: 'boathouse', detail: 'long low shed by the water', walls: 'green timber', roof: 'grey shed roof', storeys: 1, features: 'two wide doors to the water', x: 0.4, y: 0.6, sure: true }
  it('keeps a well-formed answer', () => {
    expect(parseDroneLook(JSON.stringify({ scene: 'A river bend with a boathouse.', items: [item] }))).toEqual({ scene: 'A river bend with a boathouse.', items: [item] })
  })
  it('clamps, rounds and blanks what is out of range, maps unknown kinds to other and drops repeats and things not seen', () => {
    const l = parseDroneLook(JSON.stringify({ scene: 's', items: [
      { ...item, kind: 'castle', x: 2, y: -1, storeys: 2.6, walls: 'N/A', sure: 'yes' },
      { ...item, kind: 'castle', x: 2, y: -1, storeys: 2.6, walls: 'N/A', sure: 'yes' },
      { ...item, detail: 'none visible' },
    ] }))!
    expect(l.items).toEqual([{ ...item, kind: 'other', x: 1, y: 0, storeys: 3, walls: '', sure: false }])
  })
  it('rejects a reply that is not a look', () => {
    expect(parseDroneLook('a river')).toBeNull()
    expect(parseDroneLook('{"scene":"x"}')).toBeNull()
  })
})

describe('placeDroneItem', () => {
  const fov = { h: 90, v: 90 }
  it("puts a thing where the ray through its point in the picture meets the ground, with the ray's bearing", () => {
    // Looking east, 45° down, from 50 m: the middle is 50 m east; the right edge is south-east.
    const mid = placeDroneItem([0, 0], 50, { pitch: -45, yaw: 90 }, fov, { x: 0.5, y: 0.5 }, flat(0), 0)
    expect(mid.placed).toBe('ground')
    expect(mid.range).toBeCloseTo(50, 6)
    expect(mid.bearing).toBeCloseTo(90, 6)
    close([mid.x, mid.z], [50, 0], 1e-6)
    const right = placeDroneItem([0, 0], 50, { pitch: -45, yaw: 90 }, fov, { x: 1, y: 0.5 }, flat(0), 0)
    expect(right.bearing).toBeGreaterThan(90)
    expect(right.z).toBeGreaterThan(0) // south
  })
  it('above the horizon it gives only a bearing and a point far along it', () => {
    const p = placeDroneItem([0, 0], 50, { pitch: 0, yaw: 0 }, fov, { x: 0.5, y: 0.2 }, flat(0), 0, 300)
    expect(p).toMatchObject({ placed: 'bearing', range: null })
    close([p.x, p.z], [0, -300], 1e-6)
  })
})
