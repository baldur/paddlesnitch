import { describe, it, expect } from 'vitest'
import { deriveCadence, decimateMotionCsv, parseMotionCsv } from '@paddlesnitch/timing/cadence'

const HEADER = 'ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps'

/**
 * Synthesises a motion sidecar.
 *
 * `alternating` is the important knob: real paddling swings the boat one way on
 * the left stroke and the other way on the right, so consecutive strokes are
 * mirror images and the waveform repeats over a PAIR. Reproducing that is what
 * makes the doubling test meaningful rather than decorative.
 */
function sidecar(opts: {
  seconds: number
  hz: number
  strokesPerMin: number
  alternating?: boolean
  amplitude?: number
  startMs?: number
  noise?: number
}): string {
  const { seconds, hz, strokesPerMin, alternating = true, amplitude = 40, startMs = 0, noise = 2 } = opts
  const n = Math.round(seconds * hz)
  const period = 60 / strokesPerMin          // seconds per stroke
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 2 }
  const rows: string[] = []
  for (let i = 0; i < n; i++) {
    const t = i / hz
    // Each case modelled the way the motion actually behaves, because the two
    // differ in waveform and not just in rate:
    //  - alternating (kayak): the hull rolls one way on the left stroke and back
    //    on the right, so it is a smooth swing completing one cycle per PAIR.
    //  - single-sided (always paddling one side): the same-direction catch every
    //    stroke, i.e. a pulse train at the stroke rate with no mirrored half.
    const strokeIdx = Math.floor(t / period)
    const ph = t / period - strokeIdx
    const g = alternating
      ? amplitude * Math.sin(Math.PI * t / period) + noise * rnd()
      : amplitude * Math.exp(-((ph - 0.5) ** 2) / (2 * 0.12 ** 2)) + noise * rnd()
    rows.push(`${startMs + Math.round(t * 1000)},0.01,0.02,1.00,${(g * 0.2).toFixed(3)},${g.toFixed(3)},${(g * 0.4).toFixed(3)}`)
  }
  return [HEADER, ...rows].join('\n')
}

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
