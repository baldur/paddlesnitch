import { describe, it, expect } from 'vitest'
import { haversine, processTrace, formatTime, diagnoseGates } from './geo'
import type { TrackPoint, Line } from './types'
import failingGateTrace from '../tests/fixtures/gate-66-failing-trace.json'

// Helpers
function pt(lat: number, lng: number, ms: number): TrackPoint {
  return { lat, lng, timestamp: new Date(ms) }
}

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    expect(haversine([51.5, -0.1], [51.5, -0.1])).toBe(0)
  })

  it('returns ~111km for 1 degree of latitude', () => {
    const d = haversine([0, 0], [1, 0])
    expect(d).toBeCloseTo(111195, -2) // within ~100m
  })

  it('returns ~500m for known river segment', () => {
    // ~500m along the Thames near Henley
    const d = haversine([51.5338, -0.9], [51.5383, -0.9])
    expect(d).toBeGreaterThan(490)
    expect(d).toBeLessThan(510)
  })
})

describe('processTrace', () => {
  // A simple straight track going north, crossing start at lat=0.001, finish at lat=0.005
  // Start line: horizontal line at lat=0.001 from lng=-0.001 to lng=0.001
  // Finish line: horizontal line at lat=0.005 from lng=-0.001 to lng=0.001
  const startLine: Line = [[0.001, -0.001], [0.001, 0.001]]
  const finishLine: Line = [[0.005, -0.001], [0.005, 0.001]]

  const track: TrackPoint[] = [
    pt(0.000, 0, 0),
    pt(0.002, 0, 10_000),   // crosses start line between t=0 and t=10s
    pt(0.004, 0, 20_000),
    pt(0.006, 0, 30_000),   // crosses finish line between t=20 and t=30s
    pt(0.008, 0, 40_000),
  ]

  it('detects start and finish crossings', () => {
    const result = processTrace(track, startLine, finishLine)
    expect(result).not.toBeNull()
  })

  it('calculates elapsed time correctly', () => {
    const result = processTrace(track, startLine, finishLine)!
    // Start crossing at lat=0.001, which is 50% of the way from pt[0] to pt[1] → t=5000ms
    // Finish crossing at lat=0.005, which is 50% of the way from pt[2] to pt[3] → t=25000ms
    expect(result.totalElapsedSeconds).toBeCloseTo(20, 0)
  })

  it('returns null when track does not cross start line', () => {
    const noStartTrack = [pt(0.002, 0, 0), pt(0.004, 0, 10_000)]
    expect(processTrace(noStartTrack, startLine, finishLine)).toBeNull()
  })

  it('returns null when track crosses start but not finish', () => {
    const noFinishTrack = [pt(0.000, 0, 0), pt(0.003, 0, 15_000)]
    expect(processTrace(noFinishTrack, startLine, finishLine)).toBeNull()
  })

  it('returns null for track with fewer than 2 points', () => {
    expect(processTrace([pt(0, 0, 0)], startLine, finishLine)).toBeNull()
  })

  it('includes trackSegment with start and finish interpolated points', () => {
    const result = processTrace(track, startLine, finishLine)!
    expect(result.trackSegment).toBeDefined()
    expect(result.trackSegment!.length).toBeGreaterThanOrEqual(2)
    // First point should be near the start line (lat ≈ 0.001)
    expect(result.trackSegment![0][0]).toBeCloseTo(0.001, 3)
    // Last point should be near the finish line (lat ≈ 0.005)
    expect(result.trackSegment![result.trackSegment!.length - 1][0]).toBeCloseTo(0.005, 3)
  })

  it('rounds trackSegment coordinates to 6dp to keep the payload small', () => {
    // A track whose interpolated crossing points would otherwise carry long
    // float tails; every emitted coordinate must be quantised to ≤6 decimals.
    const hp: TrackPoint[] = [
      pt(0.0000007, 0.0000003, 0),
      pt(0.0023331, 0.0000009, 10_000),
      pt(0.0047771, 0.0000001, 20_000),
      pt(0.0069999, 0.0000007, 30_000),
    ]
    const result = processTrace(hp, startLine, finishLine)!
    for (const [lat, lng] of result.trackSegment!) {
      expect(lat).toBe(Math.round(lat * 1e6) / 1e6)
      expect(lng).toBe(Math.round(lng * 1e6) / 1e6)
    }
  })

  it('never exposes heart rate, and omits stroke rate when the track has none', () => {
    // HR is never captured (sensitive biometric). Stroke rate is only present
    // when the source carried it — these points don't, so avgStrokeRate is absent.
    const result = processTrace([
      pt(0.000, 0, 0),
      pt(0.002, 0, 10_000),
      pt(0.004, 0, 20_000),
      pt(0.006, 0, 30_000),
    ], startLine, finishLine)!
    expect(result).not.toHaveProperty('avgHeartRate')
    expect(result).not.toHaveProperty('hrSeries')
    expect(result).not.toHaveProperty('avgStrokeRate')
  })

  it('averages stroke rate over the racing segment (#143)', () => {
    // strokeRate present on the segment points; the two warmup/cooldown points
    // outside start→finish must not skew the average.
    const rated = (lat: number, ms: number, sr: number): TrackPoint => ({ lat, lng: 0, timestamp: new Date(ms), strokeRate: sr })
    const result = processTrace([
      rated(0.000, 0, 99),        // t=0, before start crossing (t≈5s) — excluded
      rated(0.002, 10_000, 30),   // during the race
      rated(0.004, 20_000, 32),   // during the race
      rated(0.006, 30_000, 99),   // t=30s, after finish crossing (t≈25s) — excluded
      rated(0.008, 40_000, 99),   // after finish — excluded
    ], startLine, finishLine)!
    // Only the two points recorded inside [start≈5s, finish≈25s] count: (30+32)/2.
    expect(result.avgStrokeRate).toBeCloseTo(31, 1)
  })

  it('reports runCount = 1 for a single clean start→finish run', () => {
    const result = processTrace(track, startLine, finishLine)!
    expect(result.runCount).toBe(1)
  })

  it('counts every valid run when a trace contains more than one (#77)', () => {
    // Two separate races in one upload. After the first run the athlete
    // returns to the start via lng=0.010 — east of the line segments
    // (which only span lng -0.001..0.001) — so the return never re-crosses
    // the lines and we get exactly two clean runs, not spurious extras.
    const twoRuns: TrackPoint[] = [
      pt(0.000, 0.000, 0),
      pt(0.002, 0.000, 10_000), // crosses start  (run 1)
      pt(0.006, 0.000, 20_000), // crosses finish (run 1)
      pt(0.006, 0.010, 30_000), // east, clear of the lines
      pt(0.000, 0.010, 40_000), // south, clear of the lines
      pt(0.000, 0.000, 50_000), // back west to the start area
      pt(0.002, 0.000, 60_000), // crosses start  (run 2)
      pt(0.006, 0.000, 70_000), // crosses finish (run 2)
    ]
    const result = processTrace(twoRuns, startLine, finishLine, 'point_to_point')!
    expect(result.runCount).toBe(2)
  })

  it('rescues a run that crossed the finish line before the start (#66)', () => {
    // The athlete went south: crossed the finish line (lat 0.005) first, then
    // the start line (lat 0.001), and stopped. There is no forward
    // start→finish segment, so the forward pass yields nothing. The fallback
    // retries with the lines' roles swapped (clock runs finish→start) and times
    // it: finish-crossing at 7.5s, start-crossing at 47.5s → 40s elapsed.
    const finishFirst = [
      pt(0.008, 0, 0),
      pt(0.004, 0, 10_000),  // crosses finish line (lat 0.005) at 7.5s
      pt(0.000, 0, 60_000),  // crosses start line  (lat 0.001) at 47.5s
    ]
    const result = processTrace(finishFirst, startLine, finishLine, 'point_to_point')
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(40, 1)
  })
})

describe('processTrace — loop and gate course types', () => {
  // Line at lat=0.002; segments go 0.000→0.004 or 0.004→0.000 at lng=0,
  // so every crossing hits the midpoint at t=0.5 for clean ms arithmetic.
  const line: Line = [[0.002, -0.001], [0.002, 0.001]]

  // Track: north crossing (5s), then south crossing (25s)
  // North crossing = rxsSign +1, south crossing = rxsSign -1
  const twoPassTrack: TrackPoint[] = [
    pt(0.000, 0, 0),
    pt(0.004, 0, 10_000),   // crosses north at t=0.5 → 5s   (+1)
    pt(0.004, 0, 10_000),
    pt(0.000, 0, 30_000),   // crosses south at t=0.5 → 20s  (-1)
    pt(0.000, 0, 40_000),
  ]

  it('loop: matches any two crossings regardless of direction', () => {
    const result = processTrace(twoPassTrack, line, undefined, 'loop')
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(15, 0)
  })

  it('gate with finishLine: start at gateDirection crossing, finish at separate line', () => {
    // startGate at lat=0.001, finishGate at lat=0.005; track crosses each on separate segments → 20s
    const startGate: Line = [[0.001, -0.001], [0.001, 0.001]]
    const finishGate: Line = [[0.005, -0.001], [0.005, 0.001]]
    const gateTrack: TrackPoint[] = [
      pt(0.000, 0, 0),
      pt(0.002, 0, 10_000), // seg 0: crosses startGate at t=0.5 → 5s  (+1 northbound)
      pt(0.004, 0, 20_000),
      pt(0.006, 0, 30_000), // seg 2: crosses finishGate at t=0.5 → 25s
    ]
    const result = processTrace(gateTrack, startGate, finishGate, 'gate', 0, 1)
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(20, 0)
  })

  it('gate with finishLine: ignores start crossings in the wrong direction', () => {
    const startGate: Line = [[0.001, -0.001], [0.001, 0.001]]
    const finishGate: Line = [[0.005, -0.001], [0.005, 0.001]]
    const gateTrack: TrackPoint[] = [
      pt(0.000, 0, 0),
      pt(0.002, 0, 10_000),
      pt(0.004, 0, 20_000),
      pt(0.006, 0, 30_000),
    ]
    // gateDirection=-1 requires southbound start; track only goes north → null
    expect(processTrace(gateTrack, startGate, finishGate, 'gate', 0, -1)).toBeNull()
  })

  it('gate without finishLine: expects opposite-direction re-crossing', () => {
    const result = processTrace(twoPassTrack, line, undefined, 'gate', 0, 1)
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(15, 0)
  })

  // Legacy types still work
  it('out_and_back (legacy): opposite-direction finish', () => {
    const result = processTrace(twoPassTrack, line, undefined, 'out_and_back')
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(15, 0)
  })

  const lapTrack: TrackPoint[] = [
    pt(0.000, 0, 0),
    pt(0.004, 0, 10_000),
    pt(0.004, 0.005, 20_000),
    pt(0.000, 0.005, 30_000),
    pt(0.000, 0, 40_000),
    pt(0.004, 0, 50_000),
  ]

  it('lap (legacy): same-direction finish', () => {
    const result = processTrace(lapTrack, line, undefined, 'lap')
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(40, 0)
  })
})

describe('processTrace — minValidSeconds', () => {
  const startLine: Line = [[0.001, -0.001], [0.001, 0.001]]
  const finishLine: Line = [[0.005, -0.001], [0.005, 0.001]]

  const track: TrackPoint[] = [
    pt(0.000, 0, 0),
    pt(0.002, 0, 10_000),
    pt(0.004, 0, 20_000),
    pt(0.006, 0, 30_000),
    pt(0.008, 0, 40_000),
  ]

  it('returns result when elapsed time meets minimum', () => {
    const result = processTrace(track, startLine, finishLine, 'point_to_point', 19)
    expect(result).not.toBeNull()
    expect(result!.totalElapsedSeconds).toBeCloseTo(20, 0)
  })

  it('returns null when elapsed time is below minimum', () => {
    expect(processTrace(track, startLine, finishLine, 'point_to_point', 21)).toBeNull()
  })
})

describe('formatTime', () => {
  it('formats whole minutes correctly', () => {
    expect(formatTime(60)).toBe('1:00.0')
  })

  it('formats seconds with decimal', () => {
    expect(formatTime(75.5)).toBe('1:15.5')
  })

  it('formats sub-minute time', () => {
    expect(formatTime(42.3)).toBe('0:42.3')
  })
})

describe('diagnoseGates', () => {
  // Northbound (increasing lat) crossing of a horizontal gate line gives
  // rxsSign +1; southbound gives -1 (same convention as the gate tests above).
  const g0: Line = [[0.001, -0.001], [0.001, 0.001]]
  const g1: Line = [[0.003, -0.001], [0.003, 0.001]]
  const g2: Line = [[0.005, -0.001], [0.005, 0.001]]

  // Northbound track crossing all three gates in order, each in the +1 dir.
  const northTrack: TrackPoint[] = [
    pt(0.000, 0, 0),
    pt(0.002, 0, 10_000),  // crosses g0 (+1)
    pt(0.004, 0, 20_000),  // crosses g1 (+1)
    pt(0.006, 0, 30_000),  // crosses g2 (+1)
  ]

  it('returns no blocker when every gate is satisfied', () => {
    const gates = [g0, g1, g2].map(line => ({ line, direction: 1 as const }))
    const d = diagnoseGates(northTrack, gates)
    expect(d.gatesPassed).toBe(3)
    expect(d.blocking).toBeNull()
  })

  it('flags a gate crossed in the wrong direction', () => {
    // g1 requires -1, but the track crosses it +1.
    const gates = [
      { line: g0, direction: 1 as const },
      { line: g1, direction: -1 as const },
      { line: g2, direction: 1 as const },
    ]
    const d = diagnoseGates(northTrack, gates)
    expect(d.gatesPassed).toBe(1)
    expect(d.blocking).toEqual({ gateNumber: 2, requiredDirection: -1, reason: 'wrong_direction' })
  })

  it('flags a gate that is never crossed', () => {
    // Track stops after g1; g2 is never reached.
    const shortTrack: TrackPoint[] = [
      pt(0.000, 0, 0),
      pt(0.002, 0, 10_000),  // g0
      pt(0.004, 0, 20_000),  // g1, then stops
    ]
    const gates = [g0, g1, g2].map(line => ({ line, direction: 1 as const }))
    const d = diagnoseGates(shortTrack, gates)
    expect(d.gatesPassed).toBe(2)
    expect(d.blocking).toEqual({ gateNumber: 3, requiredDirection: 1, reason: 'not_crossed' })
  })

  it('flags the start gate when it is never crossed', () => {
    const farTrack: TrackPoint[] = [pt(1.0, 1.0, 0), pt(1.1, 1.0, 10_000)]
    const gates = [g0, g1, g2].map(line => ({ line, direction: 1 as const }))
    const d = diagnoseGates(farTrack, gates)
    expect(d.gatesPassed).toBe(0)
    expect(d.blocking).toEqual({ gateNumber: 1, requiredDirection: 1, reason: 'not_crossed' })
  })

  it('diagnoses the real #66 trace: passed 6 gates, blocked at gate 7 (wrong direction)', () => {
    // Captured from the failing prod upload — course 0WuI-dHd89MogQ0GlHAy5,
    // whose gate 7 (index 6) had its direction set backwards.
    const track: TrackPoint[] = failingGateTrace.track.map(p => ({
      lat: p.lat, lng: p.lng, timestamp: new Date(p.timestamp),
    }))
    const gates = failingGateTrace.gates as Array<{ line: Line; direction: 1 | -1 }>
    const d = diagnoseGates(track, gates)
    expect(d.total).toBe(9)
    expect(d.gatesPassed).toBe(6)
    expect(d.blocking).toEqual({ gateNumber: 7, requiredDirection: 1, reason: 'wrong_direction' })
  })
})
