// The trial page's course lines as text (#510).
import { describe, expect, it } from 'vitest'
import { courseLinesText } from './course-text'

describe('courseLinesText', () => {
  it('names the start and finish lines of a point-to-point course', () => {
    expect(courseLinesText({ type: 'point_to_point', startLine: [[64.15, -21.95], [64.151, -21.95]], finishLine: [[64.155, -21.95], [64.156, -21.951]], distanceMetres: 1000 })).toEqual([
      'Start line: from 64.15000, -21.95000 to 64.15100, -21.95000',
      'Finish line: from 64.15500, -21.95000 to 64.15600, -21.95100',
      'Distance: 1,000 m',
    ])
  })

  it('a loop has one crossing line', () => {
    expect(courseLinesText({ type: 'loop', startLine: [[1, 2], [1, 2.001]], distanceMetres: 500 })[0]).toBe('Crossing line (start and finish): from 1.00000, 2.00000 to 1.00000, 2.00100')
  })

  it('a gate course lists every gate in order', () => {
    const g = (n: number) => ({ line: [[n, 0], [n, 0.001]] as [[number, number], [number, number]], direction: 1 as const })
    expect(courseLinesText({ type: 'gate', startLine: g(1).line, gates: [g(1), g(2), g(3)], distanceMetres: 2000 }).map(s => s.split(':')[0])).toEqual(['Start gate', 'Gate 2', 'Finish gate', 'Distance'])
  })
})
