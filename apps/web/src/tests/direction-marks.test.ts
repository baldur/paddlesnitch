// Direction arrows on the compare map, and fitting the map only when the lines change.
import { describe, it, expect } from 'vitest'
import { directionMarks, linesKey } from '@/components/map/direction-marks'

describe('direction marks', () => {
  it('spaces marks evenly along the line, half a gap in from the start', () => {
    const m = directionMarks([{ x: 0, y: 0 }, { x: 100, y: 0 }], 40)
    expect(m.map(p => p.x)).toEqual([20, 60])
    expect(m.every(p => p.deg === 0)).toBe(true)
  })

  it('carries the spacing round corners and points each mark the way that leg went', () => {
    const m = directionMarks([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 60 }, { x: 0, y: 60 }], 40)
    expect(m).toEqual([
      { x: 20, y: 0, deg: 0 },     // going right
      { x: 30, y: 30, deg: 90 },   // going down the screen
      { x: 20, y: 60, deg: 180 },  // coming back left: the other leg reads the other way
    ])
  })

  it('ignores repeated points and gives nothing for a line too short', () => {
    expect(directionMarks([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }], 40)).toEqual([])
    expect(directionMarks([{ x: 5, y: 5 }], 40)).toEqual([])
  })
})

describe('fitting the compare map', () => {
  it('does not refit when the same lines arrive as new arrays (replay ticks, scrubbing)', () => {
    const a: [number, number][] = [[51.46, -0.93], [51.47, -0.92]]
    expect(linesKey([a.map(p => [...p] as [number, number]), []])).toBe(linesKey([a, []]))
  })

  it('refits when the lines change', () => {
    expect(linesKey([[[51.46, -0.93], [51.47, -0.92]]])).not.toBe(linesKey([[[51.46, -0.93], [51.48, -0.92]]]))
  })
})
