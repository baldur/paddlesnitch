import { describe, it, expect } from 'vitest'
import { banks, chainCentreline, crossings, cumulative, locate, projection, recentre, resample, thinLine, type XZ } from './river'

describe('projection', () => {
  it('puts north at -z and east at +x, in metres, and round-trips', () => {
    const { toXZ, toLatLng } = projection([51.46, -0.97])
    const [x, z] = toXZ([51.46 + 0.009, -0.97])        // ~1 km north
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(-1000.8, 0)
    expect(toXZ([51.46, -0.97 + 0.0144])[0]).toBeCloseTo(1000, -1) // ~1 km east at this latitude
    const back = toLatLng([123, -456])
    expect(toXZ(back)[0]).toBeCloseTo(123, 6)
    expect(toXZ(back)[1]).toBeCloseTo(-456, 6)
  })
})

describe('locate', () => {
  it('measures along the line and says which side, right of travel positive', () => {
    const line: XZ[] = [[0, 0], [0, -100]]                  // heading north
    const cum = cumulative(line)
    expect(locate(line, cum, [5, -40])).toMatchObject({ s: 40, lateral: 5 })   // east is right when heading north
    expect(locate(line, cum, [-5, -40]).lateral).toBe(-5)
  })
})

describe('chainCentreline', () => {
  it('follows the channel nearer the paddler round an island', () => {
    // Two channels between (0,0) and (0,-200): one bowing east, one bowing west.
    const east: XZ[] = [[0, 0], [30, -100], [0, -200]]
    const west: XZ[] = [[0, 0], [-30, -100], [0, -200]]
    const guide: XZ[] = [[-28, -90], [-28, -110]]
    const line = chainCentreline([east, west], [0, 0], [0, -200], guide)
    expect(line.some(([x]) => x < -20)).toBe(true)
    expect(line.some(([x]) => x > 20)).toBe(false)
  })

  it('joins ways that meet end to end', () => {
    const line = chainCentreline([[[0, 0], [0, -50]], [[0, -50], [0, -100]]], [0, 0], [0, -100], [])
    expect(cumulative(line).at(-1)).toBeCloseTo(100)
  })

  it('ends at the end point without doubling back past it', () => {
    // The mapped river runs on 40 m past both points.
    const line = chainCentreline([[[0, 40], [0, 0], [0, -100], [0, -200], [0, -240]]], [0, -10], [0, -205], [])
    expect(line[0]).toEqual([0, -10])
    expect(line.at(-1)).toEqual([0, -205])
    const zs = line.map(([, z]) => z)
    expect(zs).toEqual([...zs].sort((a, b) => b - a)) // always heading north
  })

  it('says so when the ways do not connect', () => {
    expect(() => chainCentreline([[[0, 0], [0, -50]], [[0, -60], [0, -100]]], [0, 0], [0, -100], [])).toThrow(/connect/)
  })
})

describe('banks and recentre', () => {
  // A straight river heading north, banks at x = -10 and x = +30.
  const shore: Array<[XZ, XZ]> = [[[-10, 50], [-10, -250]], [[30, 50], [30, -250]]]
  const line = resample([[0, 0], [0, -200]], 10)

  it('casts square to the line to each bank', () => {
    const e = banks(line, shore)
    expect(e[5]).toEqual({ left: 10, right: 30 })
  })

  it('moves the line to the middle of the water', () => {
    const middle = recentre(line, banks(line, shore))
    expect(middle[10][0]).toBeCloseTo(10)
  })

  it('stops at an island before the far bank', () => {
    const island: Array<[XZ, XZ]> = [[[15, -80], [15, -120]]]
    expect(banks(line, [...shore, ...island])[10].right).toBe(15)
  })

  it('reports no bank when there is none within reach', () => {
    expect(banks(line, shore, 20)[5]).toEqual({ left: 10, right: null })
  })
})

describe('crossings', () => {
  it('finds where a bridge deck crosses the line', () => {
    const line: XZ[] = [[0, 0], [0, -100], [0, -200]]
    expect(crossings(line, cumulative(line), [[-20, -150], [20, -150]])).toEqual([150])
  })
})

describe('thinLine', () => {
  it('drops points closer than the tolerance, keeping both ends', () => {
    const line: XZ[] = [[0, 0], [0.5, 0], [1, 0], [3, 0], [3.2, 0], [3.4, 0]]
    expect(thinLine(line, 1.5)).toEqual([[0, 0], [3, 0], [3.4, 0]])
  })
})

