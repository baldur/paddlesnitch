import { describe, it, expect } from 'vitest'
import {
  deriveCadence, decimateMotionCsv, parseMotionCsv, strokeRateSeries, movingRangesFromTrack, trackClockOffset, withStrokeRate,
} from '@paddlesnitch/timing/cadence'
import { addStrokeRate } from '@paddlesnitch/analysis/device-sessions'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import { HEADER, sidecar, trackCsv } from '@/tests/tracker-fixtures'

describe('parseMotionCsv', () => {
  it('reads the sidecar with or without a header row', () => {
    const withHeader = sidecar({ seconds: 2, hz: 50, strokesPerMin: 60 })
    const without = withHeader.split('\n').slice(1).join('\n')
    expect(parseMotionCsv(withHeader).length).toBe(100)
    expect(parseMotionCsv(without).length).toBe(100)
  })
})

describe('deriveCadence', () => {
  it('recovers a known alternating stroke rate', () => {
    const r = deriveCadence(sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 }))
    expect(r.available).toBe(true)
    expect(r.medianStrokesPerMin).toBeGreaterThan(52)
    expect(r.medianStrokesPerMin).toBeLessThan(60)
    expect(r.windows[0].alternating).toBe(true)
  })

  it('does NOT double a single-sided rhythm', () => {
    // No mirror-image half-cycle, so the cycle rate IS the stroke rate. Getting
    // this wrong is a silent factor-of-two error in the headline number.
    const r = deriveCadence(sidecar({ seconds: 180, hz: 50, strokesPerMin: 50, alternating: false }))
    expect(r.available).toBe(true)
    expect(r.windows[0].alternating).toBe(false)
    expect(r.medianStrokesPerMin).toBeGreaterThan(46)
    expect(r.medianStrokesPerMin).toBeLessThan(54)
  })

  it('gives the same answer at 10 Hz as at 50 Hz — which is why we upload 10 Hz', () => {
    const fast = deriveCadence(sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 }))
    const slow = deriveCadence(sidecar({ seconds: 180, hz: 10, strokesPerMin: 56 }))
    expect(slow.available).toBe(true)
    expect(Math.abs(slow.medianStrokesPerMin! - fast.medianStrokesPerMin!)).toBeLessThan(4)
  })

  it('reports no cadence for a stationary device instead of inventing one', () => {
    // Low-level broadband noise, no rhythm. The failure mode this guards against
    // is an autocorrelation that rails against the band edge and returns it as if
    // it were a measurement.
    let seed = 3
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 2 }
    const rows = Array.from({ length: 3000 }, (_, i) =>
      `${i * 20},0.01,0.02,1.00,${(rnd() * 3).toFixed(3)},${(rnd() * 3).toFixed(3)},${(rnd() * 3).toFixed(3)}`)
    const r = deriveCadence([HEADER, ...rows].join('\n'))
    expect(r.available).toBe(false)
    expect(r.medianStrokesPerMin).toBeNull()
  })

  it('ignores windows outside the moving ranges', () => {
    // 120 s parked, then 180 s paddling — the shape of every real session.
    const parked = Array.from({ length: 120 * 50 }, (_, i) =>
      `${i * 20},0.01,0.02,1.00,0.1,0.2,0.1`).join('\n')
    const moving = sidecar({ seconds: 180, hz: 50, strokesPerMin: 56, startMs: 120_000 })
      .split('\n').slice(1).join('\n')
    const csv = [HEADER, parked, moving].join('\n')

    const scoped = deriveCadence(csv, { movingRanges: [[120_000, 300_000]] })
    expect(scoped.available).toBe(true)
    expect(scoped.windows.every(w => w.tMs >= 100_000)).toBe(true)
  })

  it('refuses data sampled too slowly to carry a stroke', () => {
    const r = deriveCadence(sidecar({ seconds: 300, hz: 1, strokesPerMin: 56 }))
    expect(r.available).toBe(false)
    expect(r.reason).toMatch(/too slow/i)
  })
})

describe('decimateMotionCsv', () => {
  it('cuts 50 Hz to 10 Hz, keeps the header, and preserves the cadence', () => {
    const full = sidecar({ seconds: 180, hz: 50, strokesPerMin: 56 })
    const small = decimateMotionCsv(full)
    expect(small.split('\n')[0]).toBe(HEADER)
    expect(small.length).toBeLessThan(full.length / 4)

    const before = deriveCadence(full).medianStrokesPerMin!
    const after = deriveCadence(small).medianStrokesPerMin!
    expect(Math.abs(after - before)).toBeLessThan(4)
  })

  it('leaves data alone that is already at or below the target rate', () => {
    const already = sidecar({ seconds: 60, hz: 10, strokesPerMin: 56 })
    expect(decimateMotionCsv(already, 10).trim()).toBe(already.trim())
  })
})

// Joins sidecars made one after the other into one file (one header).
const joined = (...parts: string[]) => [HEADER, ...parts.flatMap(p => p.split('\n').slice(1))].join('\n')
const at = (pts: { ms: number; strokesPerMin: number }[], from: number, to: number) =>
  pts.filter(p => p.ms >= from && p.ms < to).map(p => p.strokesPerMin)

describe('strokeRateSeries (stroke rate through the paddle)', () => {
  it('follows a change of rate instead of averaging it away', () => {
    const csv = joined(
      sidecar({ seconds: 120, hz: 10, strokesPerMin: 48 }),
      sidecar({ seconds: 120, hz: 10, strokesPerMin: 72, startMs: 120_000 }),
    )
    const pts = strokeRateSeries(csv)
    for (const v of at(pts, 0, 100_000)) expect(v).toBeGreaterThan(44), expect(v).toBeLessThan(52)
    for (const v of at(pts, 140_000, 240_000)) expect(v).toBeGreaterThan(67), expect(v).toBeLessThan(77)
  })

  it('leaves a rest as a gap, never a zero or a guess', () => {
    const csv = joined(
      sidecar({ seconds: 90, hz: 10, strokesPerMin: 56 }),
      sidecar({ seconds: 60, hz: 10, strokesPerMin: 56, amplitude: 0, startMs: 90_000 }),
      sidecar({ seconds: 90, hz: 10, strokesPerMin: 56, startMs: 150_000 }),
    )
    const pts = strokeRateSeries(csv)
    expect(at(pts, 105_000, 135_000)).toEqual([])
    expect(at(pts, 0, 80_000).length).toBeGreaterThan(5)
    expect(at(pts, 160_000, 240_000).length).toBeGreaterThan(5)
    expect(pts.every(p => p.strokesPerMin > 50)).toBe(true)
  })

  it('only uses stretches where the boat was moving', () => {
    const csv = sidecar({ seconds: 180, hz: 10, strokesPerMin: 56 })
    const pts = strokeRateSeries(csv, { movingRanges: [[60_000, 120_000]] })
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.every(p => p.ms >= 60_000 && p.ms <= 120_000)).toBe(true)
  })

  it('gives single-sided paddling no series yet (only calibrated on synthetic data)', () => {
    expect(strokeRateSeries(sidecar({ seconds: 180, hz: 10, strokesPerMin: 40, alternating: false }))).toEqual([])
  })

  it('gives too short a recording no series: too few windows to decide left/right', () => {
    expect(strokeRateSeries(sidecar({ seconds: 40, hz: 10, strokesPerMin: 56 }))).toEqual([])
  })

  it('drops a lone window with no neighbour: too little to trust', () => {
    const csv = sidecar({ seconds: 60, hz: 10, strokesPerMin: 56 })
    expect(strokeRateSeries(csv, { movingRanges: [[10_000, 26_000]] })).toEqual([])
  })
})

describe('joining stroke rate to the track', () => {
  it('finds the moving stretches after a serial-capture marker line', () => {
    const csv = trackCsv(100, 8, { marker: true })
    expect(movingRangesFromTrack(csv, 20)).toEqual([[0, 99_000]])
    expect(movingRangesFromTrack(csv)).toEqual([[0, 99_000]])
    expect(movingRangesFromTrack(trackCsv(60, 8))).toEqual([])   // shorter than the 90 s default
  })

  it('reads the tracker clock against GPS time', () => {
    expect(trackClockOffset(trackCsv(30, 8, { startMs: 5000 }))).toBe(Date.parse('2026-10-06T09:00:00Z') - 5000)
    expect(trackClockOffset('ms,ax_g\n1,2')).toBeNull()
  })

  it('gives each point the nearest window within half a step, and nothing in a gap', () => {
    const t0 = Date.parse('2026-10-06T09:00:00Z')
    const track: { lat: number; lng: number; timestamp: Date; strokeRate?: number }[] =
      Array.from({ length: 40 }, (_, i) => ({ lat: 0, lng: 0, timestamp: new Date(t0 + i * 1000) }))
    const series = [{ ms: 10_000, strokesPerMin: 50, confidence: 0.8 }, { ms: 15_000, strokesPerMin: 54, confidence: 0.8 }]
    const out = withStrokeRate(track, series, t0)
    expect(out[10].strokeRate).toBe(50)
    expect(out[12].strokeRate).toBe(50)
    expect(out[13].strokeRate).toBe(54)
    expect(out[17].strokeRate).toBe(54)
    expect(out[5].strokeRate).toBeUndefined()
    expect(out[30].strokeRate).toBeUndefined()
  })

  it('never replaces a stroke rate the file already carries', () => {
    const t0 = Date.parse('2026-10-06T09:00:00Z')
    const out = withStrokeRate([{ lat: 0, lng: 0, timestamp: new Date(t0), strokeRate: 30 }], [{ ms: 0, strokesPerMin: 60, confidence: 1 }], t0)
    expect(out[0].strokeRate).toBe(30)
  })

  it('gives a tracker paddle a stroke rate per effort from its motion data', async () => {
    const csv = trackCsv(300, 9, { startMs: 400_000 })
    const motion = sidecar({ seconds: 300, hz: 10, strokesPerMin: 56, startMs: 400_000 })
    const { parseTrace } = await import('@paddlesnitch/timing/parse')
    const parsed = await parseTrace('trace.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer)
    if (!parsed.ok) throw new Error('fixture did not parse')
    const track = addStrokeRate(parsed.track, csv, motion)
    expect(track.filter(p => p.strokeRate != null).length).toBeGreaterThan(200)
    const r = analyseTrack(track, {})
    expect(r.avgSR).toBeGreaterThan(52)
    expect(r.avgSR).toBeLessThan(60)
  })

  it('leaves the GPS-only track when the motion data is unusable', () => {
    const track = [{ lat: 0, lng: 0, timestamp: new Date() }]
    expect(addStrokeRate(track, 'nonsense', 'nonsense')).toBe(track)
  })
})
