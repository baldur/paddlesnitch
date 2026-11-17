import { describe, it, expect } from 'vitest'
import { average, cameraYawOf, choosePass, choosePasses, cleanScores, gameCamera, headingAt, pickPoints, viewFacing } from './views'

describe('pickPoints', () => {
  it('spreads places every 200 m up the river, and adds one off each landmark looking at it', () => {
    const points = pickPoints(1000, (s) => [s, 0], [{ name: 'Reading Canoe Club', at: [430, -40], s: 430 }])
    expect(points.map((p) => p.id)).toEqual(['s100', 's300', 's500', 's700', 's900', 'reading-canoe-club'])
    expect(points.at(-1)).toMatchObject({ at: [430, 0], target: [430, -40] })
  })
})

describe('headingAt', () => {
  // North at about 1 m/s: a degree of latitude is 111 km.
  const north = Array.from({ length: 20 }, (_, i) => [i, 51.46 + i / 111_000, -0.97])
  it('is the way the camera was going, clockwise from north', () => {
    expect(headingAt(north, 10)).toBeCloseTo(0, 0)
    const east = north.map(([t]) => [t, 51.46, -0.97 + t / 69_000])
    expect(headingAt(east, 10)).toBeCloseTo(90, 0)
  })
  it('is unknown when the boat sat still', () => {
    expect(headingAt(north.map(([t]) => [t, 51.46, -0.97]), 10)).toBeNull()
  })
})

describe('choosePass', () => {
  const pass = (metres: number, extra: object) => ({ ft: 1, lat: 0, lng: 0, metres, cameraKnown: true, cameraYaw: 0, hour: 9, heading: 10, ...extra })
  it("takes a pass whose camera's direction is known over a closer one where it's assumed", () => {
    expect(choosePass([pass(2, { cameraKnown: false }), pass(9, {})])?.metres).toBe(9)
  })
  it('skips the night, a still boat and a camera whose direction is anyone’s guess', () => {
    expect(choosePass([pass(1, { hour: 4 }), pass(2, { heading: null }), pass(3, { cameraYaw: null }), pass(4, {})])?.metres).toBe(4)
    expect(choosePass([pass(1, { hour: 22 })])).toBeNull()
  })
  it("assumes a clip's camera from its folder: rowing faced the bow, kayak the stern", () => {
    expect([cameraYawOf(null, 'rowing'), cameraYawOf(null, 'kayak'), cameraYawOf(null, 'pair'), cameraYawOf(90, 'kayak')]).toEqual([0, 180, null, 90])
  })
})

describe('choosePasses', () => {
  const pass = (metres: number, recording: string, extra: object = {}) => ({ ft: 1, lat: 0, lng: 0, metres, recording, cameraKnown: true, cameraYaw: 0, hour: 9, heading: 10, ...extra })
  it('takes one pass from each recording, the closest of each, known cameras first, up to n', () => {
    const got = choosePasses([pass(5, 'a'), pass(3, 'a'), pass(8, 'b'), pass(1, 'c', { cameraKnown: false }), pass(2, 'd', { hour: 4 }), pass(9, 'e')], 3)
    expect(got.map((p) => [p.recording, p.metres])).toEqual([['a', 3], ['b', 8], ['e', 9]])
  })
})

describe('viewFacing and gameCamera', () => {
  it("picks the view facing the landmark: going north, one to the west is on the left", () => {
    expect(viewFacing(0, [0, 0], [-50, 0])).toBe('left')
    expect(viewFacing(0, [0, 0], [50, 0])).toBe('right')
    expect(viewFacing(0, [0, 0], [0, 50])).toBe('behind') // z is south
    expect(viewFacing(0, [0, 0])).toBe('ahead')
  })
  it("puts the game's eye where the frame was taken, looking the view's way (north is -z)", () => {
    const c = gameCamera([10, 20], 0, 'right')
    expect(c.eye).toEqual([10, 0.8, 20])
    expect(c.look[0]).toBeCloseTo(60)
    expect(c.look[2]).toBeCloseTo(20)
    expect(gameCamera([0, 0], 0, 'ahead').look[2]).toBeCloseTo(-50)
  })
})

describe('scores', () => {
  it('keeps only whole 1–5 scores for known views under plain labels', () => {
    const s = cleanScores({ 'blocks-1': { s100: 3, s300: 7, s500: 2.5, gone: 4 }, '../x': { s100: 1 }, ok: 'no' }, ['s100', 's300', 's500'])
    expect(s).toEqual({ 'blocks-1': { s100: 3 } })
    expect(average({ a: { s100: 2, s300: 5 } }, 'a')).toEqual({ mean: 3.5, n: 2 })
    expect(average({}, 'a')).toEqual({ mean: null, n: 0 })
  })
})
