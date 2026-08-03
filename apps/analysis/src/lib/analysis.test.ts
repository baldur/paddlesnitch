import { describe, it, expect } from 'vitest'
import { analyseTrack, fmtDurWords, rescaleDoubling } from './analysis'
import type { TrackPoint } from '@paddlesnitch/timing/types'

// Build a synthetic northbound track: a rest, a cruise, a faster surge, a rest.
// Speed is set by the per-step latitude delta (1° lat ≈ 111 km).
function track(): TrackPoint[] {
  const pts: TrackPoint[] = []
  let lat = 51.5, t = 0
  const push = (mps: number, sr: number, secs: number) => {
    for (let i = 0; i < secs; i++) { lat += mps / 111_000; pts.push({ lat, lng: -0.9, timestamp: new Date(t * 1000), strokeRate: sr }); t++ }
  }
  push(0.2, 10, 20)   // rest / drifting
  push(3.0, 30, 90)   // cruise
  push(4.3, 40, 60)   // a clear surge
  push(0.2, 10, 20)   // rest
  return pts
}

describe('analyseTrack', () => {
  it('derives duration + distance and detects a surge and the rests', () => {
    const r = analyseTrack(track())
    expect(r.durationS).toBeGreaterThan(180)
    expect(r.distanceKm).toBeGreaterThan(0.3)
    expect(r.surges.length).toBeGreaterThanOrEqual(1)   // the 4.3 m/s block
    expect(r.stops.length).toBeGreaterThanOrEqual(1)     // the drifting blocks
    // the surge should be the fastest segment and carry a trend + stroke rate
    expect(r.surges[0].avgSpeed).toBeGreaterThan(r.cruiseSpeed)
    expect(r.surges[0].avgSR).toBeGreaterThan(0)
    expect(r.surges[0].trend).toBeTruthy()
  })

  it('doubles stroke rate + halves distance-per-stroke for SUP→kayak', () => {
    const base = analyseTrack(track())
    const dbl = analyseTrack(track(), { doubleStrokeRate: true })
    expect(dbl.strokeRateDoubled).toBe(true)
    expect(Math.round(dbl.avgSR!)).toBe(Math.round(base.avgSR! * 2))
    // dps = speed ÷ (sr/60), so doubling sr halves dps
    expect(dbl.avgDps!).toBeCloseTo(base.avgDps! / 2, 1)
  })

  it('always produces a non-empty insight string', () => {
    expect(analyseTrack(track()).insight.length).toBeGreaterThan(20)
  })
})

describe('rescaleDoubling', () => {
  it('flips doubling as an exact rescale of SR-derived fields, leaving speed/segments intact', () => {
    const base = analyseTrack(track())                  // not doubled
    const on = rescaleDoubling(base, true)
    expect(on.strokeRateDoubled).toBe(true)
    expect(on.avgSR!).toBeCloseTo(base.avgSR! * 2, 6)
    expect(on.avgDps!).toBeCloseTo(base.avgDps! / 2, 6)
    // speed + segmentation untouched
    expect(on.cruiseSpeed).toBe(base.cruiseSpeed)
    expect(on.surges.length).toBe(base.surges.length)
    expect(on.surges[0].avgSpeed).toBe(base.surges[0].avgSpeed)
    expect(on.surges[0].srCv).toBeCloseTo(base.surges[0].srCv!, 6) // CV is scale-invariant
    // matches a fresh doubled analysis
    const fresh = analyseTrack(track(), { doubleStrokeRate: true })
    expect(on.avgSR!).toBeCloseTo(fresh.avgSR!, 6)
  })

  it('round-trips back to the original', () => {
    const base = analyseTrack(track())
    const back = rescaleDoubling(rescaleDoubling(base, true), false)
    expect(back.strokeRateDoubled).toBe(false)
    expect(back.avgSR!).toBeCloseTo(base.avgSR!, 6)
    expect(back.avgDps!).toBeCloseTo(base.avgDps!, 6)
  })
})

describe('fmtDurWords', () => {
  it('frames whole minutes with no seconds', () => {
    expect(fmtDurWords(120)).toBe('2 minutes')
    expect(fmtDurWords(60)).toBe('1 minute')
  })
  it('frames minutes and seconds', () => {
    expect(fmtDurWords(82)).toBe('1 minute 22 seconds')
    expect(fmtDurWords(150)).toBe('2 minutes 30 seconds')
  })
  it('uses singular for one second', () => {
    expect(fmtDurWords(61)).toBe('1 minute 1 second')
  })
  it('frames sub-minute durations as seconds only', () => {
    expect(fmtDurWords(45)).toBe('45 seconds')
    expect(fmtDurWords(0)).toBe('0 seconds')
  })
  it('rounds fractional seconds', () => {
    expect(fmtDurWords(82.4)).toBe('1 minute 22 seconds')
    expect(fmtDurWords(59.6)).toBe('1 minute')
  })
  it('frames whole hours with no minutes or seconds', () => {
    expect(fmtDurWords(3600)).toBe('1 hour')
    expect(fmtDurWords(7200)).toBe('2 hours')
  })
  it('frames hours with minutes and seconds', () => {
    expect(fmtDurWords(3720)).toBe('1 hour 2 minutes')
    expect(fmtDurWords(3661)).toBe('1 hour 1 minute 1 second')
    expect(fmtDurWords(3605)).toBe('1 hour 5 seconds')
  })
})
