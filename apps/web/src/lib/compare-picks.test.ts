import { describe, it, expect } from 'vitest'
import { rankForComparison } from '@paddlesnitch/analysis/same-outing'

// The owner's real case (2026-10-11): their buddy's paddle that morning, and
// their own paddles, all starting at the same club within metres.
const CLUB = { startLat: 51.4677, startLng: -0.9821 }
const hers = { paddledAt: '2026-10-11T07:38:00Z', durationS: 108 * 60, startLat: 51.467787, startLng: -0.98215 }
const mine = [
  { id: 'oct11', paddledAt: '2026-10-11T07:39:00Z', durationS: 98 * 60, startLat: 51.467626, startLng: -0.98173 },   // ~34 m from hers
  { id: 'oct10', paddledAt: '2026-10-10T10:27:00Z', durationS: 126 * 60, startLat: 51.466921, startLng: -0.979198 },
  { id: 'oct09', paddledAt: '2026-10-09T06:19:00Z', durationS: 74 * 60, startLat: 51.467743, startLng: -0.98188 },  // ~20 m: "nearest"
  { id: 'aug01', paddledAt: '2026-08-01T07:00:00Z', durationS: 60 * 60, ...CLUB },
  { id: 'away', paddledAt: '2026-10-08T07:00:00Z', durationS: 60 * 60, startLat: 51.75, startLng: -1.25 },         // another river
]

describe('which of my paddles to offer for comparison', () => {
  it('puts the outing we paddled together first, though another of mine started nearer hers', () => {
    const r = rankForComparison(hers, mine)
    expect(r[0]).toMatchObject({ kind: 'together', paddle: { id: 'oct11' } })
  })

  it('then the same water newest first, then elsewhere', () => {
    expect(rankForComparison(hers, mine).map(x => `${x.paddle.id}:${x.kind}`)).toEqual([
      'oct11:together', 'oct10:same_water', 'oct09:same_water', 'aug01:same_water', 'away:elsewhere',
    ])
  })

  it('a paddle with no start point still appears, by date, after the same water', () => {
    const r = rankForComparison(hers, [...mine, { id: 'nostart', paddledAt: '2026-10-11T12:00:00Z', durationS: 600 }])
    expect(r.map(x => x.paddle.id)).toEqual(['oct11', 'oct10', 'oct09', 'aug01', 'nostart', 'away'])
  })
})
