import { describe, it, expect } from 'vitest'
import { deriveAttitude } from '@paddlesnitch/timing/attitude'

const HEADER = 'ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps'

/**
 * Synthesises a boat rolling about its fore-aft axis (and optionally pitching).
 *
 * `mount` rotates the whole thing into an arbitrary device orientation, because
 * the tracker is not mounted squarely and the analyser must not assume it is.
 *
 * `weakSide` scales one half of every roll cycle — the boat swinging further one
 * way than the other. That is the asymmetry a kayaker can act on, and unlike a
 * CONSTANT lean it is actually measurable: a steady list is indistinguishable
 * from a device mounted a few degrees off.
 */
function boat(opts: {
  seconds: number
  hz: number
  rollAmpDeg: number
  rollHz?: number
  pitchAmpDeg?: number
  weakSide?: number
  mount?: 'square' | 'tilted'
}): string {
  const { seconds, hz, rollAmpDeg, rollHz = 0.45, pitchAmpDeg = 0, weakSide = 1, mount = 'square' } = opts
  const n = Math.round(seconds * hz)
  const rad = (d: number) => (d * Math.PI) / 180
  const rows: string[] = []

  // A fixed, deliberately awkward mounting rotation.
  const m = rad(mount === 'tilted' ? 37 : 0)
  const rot = (v: [number, number, number]): [number, number, number] =>
    [v[0] * Math.cos(m) - v[2] * Math.sin(m), v[1], v[0] * Math.sin(m) + v[2] * Math.cos(m)]

  for (let i = 0; i < n; i++) {
    const t = i / hz
    const sw = Math.sin(2 * Math.PI * rollHz * t)
    const roll = rad(rollAmpDeg * (sw < 0 ? sw * weakSide : sw))
    const pitch = rad(pitchAmpDeg * Math.sin(2 * Math.PI * rollHz * 2 * t))
    // Gravity in body frame for this roll/pitch (small-angle-ish, exact enough).
    const g: [number, number, number] = [
      Math.sin(pitch),
      -Math.sin(roll) * Math.cos(pitch),
      Math.cos(roll) * Math.cos(pitch),
    ]
    // Body rates: d(roll)/dt about x, d(pitch)/dt about y.
    const dRoll = rad(rollAmpDeg * (sw < 0 ? weakSide : 1) * 2 * Math.PI * rollHz * Math.cos(2 * Math.PI * rollHz * t))
    const dPitch = rad(pitchAmpDeg * 2 * Math.PI * rollHz * 2 * Math.cos(2 * Math.PI * rollHz * 2 * t))
    const w: [number, number, number] = [dRoll, dPitch, 0]

    const gr = rot(g), wr = rot(w)
    const dps = (v: number) => ((v * 180) / Math.PI).toFixed(3)
    rows.push(`${Math.round(t * 1000)},${gr[0].toFixed(4)},${gr[1].toFixed(4)},${gr[2].toFixed(4)},${dps(wr[0])},${dps(wr[1])},${dps(wr[2])}`)
  }
  return [HEADER, ...rows].join('\n')
}

describe('deriveAttitude', () => {
  it('recovers roll amplitude from a squarely mounted device', () => {
    const r = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }))
    expect(r.available).toBe(true)
    // rms of a sine of amplitude A is A/sqrt(2) ~= 5.7 deg
    expect(r.rollRmsDeg!).toBeGreaterThan(4.5)
    expect(r.rollRmsDeg!).toBeLessThan(7)
    expect(r.pitchRmsDeg!).toBeLessThan(2)
  })

  it('gives the same answer when the device is mounted at an awkward angle', () => {
    // The whole point of learning gravity and the roll axis from the data: a
    // tracker in a pocket is not aligned with the hull.
    const square = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }))
    const tilted = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8, mount: 'tilted' }))
    expect(tilted.available).toBe(true)
    expect(Math.abs(tilted.rollRmsDeg! - square.rollRmsDeg!)).toBeLessThan(1.5)
  })

  it('separates a rowing-style level hull from a kayak-style rocking one', () => {
    const level = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 1 }))
    const rocking = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 10 }))
    expect(level.rollRmsDeg!).toBeLessThan(2)
    expect(rocking.rollRmsDeg!).toBeGreaterThan(5)
  })

  it('reports an even roll as near-symmetric', () => {
    const r = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }))
    expect(Math.abs(r.symmetry!.imbalancePct)).toBeLessThan(12)
  })

  it('detects rocking harder one way than the other', () => {
    // The kayak fault worth surfacing: swinging well out on one side, barely
    // moving on the other.
    const r = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8, weakSide: 0.35 }))
    expect(r.symmetry).not.toBeNull()
    expect(Math.abs(r.symmetry!.imbalancePct)).toBeGreaterThan(15)
  })

  it('does NOT report a constant lean as asymmetry — it cannot be told from the mounting', () => {
    // A boat held 3 degrees down one side all session and a tracker screwed on
    // 3 degrees off produce identical data. Claiming to measure the first would
    // be inventing a finding.
    const even = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }))
    expect(Math.abs(even.symmetry!.imbalancePct)).toBeLessThan(12)
  })

  it('flags that roll and pitch cannot be told apart when they are equal', () => {
    // Not a failure — the motion is real, but which axis is which is guesswork,
    // and the report has to say so rather than pick one.
    const r = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 6, pitchAmpDeg: 6, rollHz: 0.45 }))
    expect(r.available).toBe(true)
    expect(r.axisConfident).toBe(false)
  })

  it('works at the 10 Hz the device actually uploads', () => {
    const fast = deriveAttitude(boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }))
    const slow = deriveAttitude(boat({ seconds: 180, hz: 10, rollAmpDeg: 8 }))
    expect(slow.available).toBe(true)
    expect(Math.abs(slow.rollRmsDeg! - fast.rollRmsDeg!)).toBeLessThan(1)
  })

  it('confines itself to the moving stretches', () => {
    const parked = Array.from({ length: 120 * 50 }, (_, i) => `${i * 20},0,0,1.0,0,0,0`).join('\n')
    const moving = boat({ seconds: 180, hz: 50, rollAmpDeg: 8 }).split('\n').slice(1)
      .map(l => { const p = l.split(','); return [String(Number(p[0]) + 120_000), ...p.slice(1)].join(',') }).join('\n')
    const r = deriveAttitude([HEADER, parked, moving].join('\n'), { movingRanges: [[120_000, 300_000]] })
    expect(r.available).toBe(true)
    expect(r.rollRmsDeg!).toBeGreaterThan(4)   // the parked half would have dragged this down
  })

  describe('data for plotting', () => {
    it('returns an envelope that spans the session and brackets the real motion', () => {
      const r = deriveAttitude(boat({ seconds: 300, hz: 50, rollAmpDeg: 8 }))
      expect(r.envelope.length).toBeGreaterThan(20)
      expect(r.envelope.length).toBeLessThanOrEqual(240)
      // Every bucket is a RANGE, so max must sit above min.
      expect(r.envelope.every(b => b.rollMax >= b.rollMin)).toBe(true)
      // A steady 8 deg roll should show buckets reaching out near that.
      const widest = Math.max(...r.envelope.map(b => b.rollMax - b.rollMin))
      expect(widest).toBeGreaterThan(6)
      // Ordered in time.
      expect(r.envelope.every((b, i) => i === 0 || b.t >= r.envelope[i - 1].t)).toBe(true)
    })

    it('keeps the envelope honest where plain decimation would alias', () => {
      // The rocking is ~0.45 Hz. Sampling one instant per chart-pixel over a long
      // session draws a waveform that never happened; a min/max band cannot.
      const r = deriveAttitude(boat({ seconds: 600, hz: 50, rollAmpDeg: 8 }))
      const reach = Math.max(...r.envelope.map(b => b.rollMax))
      expect(reach).toBeGreaterThan(5)   // the peaks survive the reduction
    })

    it('returns a full-rate excerpt to show the stroke shape', () => {
      const r = deriveAttitude(boat({ seconds: 300, hz: 50, rollAmpDeg: 8 }))
      expect(r.excerpt.length).toBeGreaterThan(100)
      const span = (r.excerpt[r.excerpt.length - 1].t - r.excerpt[0].t) / 1000
      expect(span).toBeGreaterThan(20)
      expect(span).toBeLessThan(40)
    })

    it('bins roll into a histogram centred on level', () => {
      const r = deriveAttitude(boat({ seconds: 300, hz: 50, rollAmpDeg: 8 }))
      expect(r.rollHistogram).not.toBeNull()
      const bins = r.rollHistogram!.bins
      expect(bins.length).toBe(41)
      // Counts account for every sample.
      expect(bins.reduce((a, b) => a + b.count, 0)).toBe(r.samples)
      // Symmetric rocking → the two halves hold roughly equal mass.
      const left = bins.filter(b => b.centreDeg < 0).reduce((a, b) => a + b.count, 0)
      const right = bins.filter(b => b.centreDeg > 0).reduce((a, b) => a + b.count, 0)
      expect(Math.abs(left - right) / (left + right)).toBeLessThan(0.2)
    })

    it('shows an uneven stroke as a lopsided histogram, and an even one as balanced', () => {
      // Asserted as a COMPARISON rather than against a tuned constant: the
      // absolute ratio depends on bin resolution, but an even stroke must come
      // out near 1 and a lopsided one clearly above it.
      const lopsidedness = (weakSide: number) => {
        const r = deriveAttitude(boat({ seconds: 300, hz: 50, rollAmpDeg: 8, weakSide }))
        const used = r.rollHistogram!.bins.filter(b => b.count > 0).map(b => b.centreDeg)
        return Math.abs(Math.max(...used)) / Math.abs(Math.min(...used))
      }
      const even = lopsidedness(1)
      const uneven = lopsidedness(0.35)
      expect(even).toBeGreaterThan(0.8)
      expect(even).toBeLessThan(1.25)
      expect(uneven).toBeGreaterThan(even * 1.25)
    })
  })

  it('refuses data with too few samples instead of guessing', () => {
    const r = deriveAttitude(`${HEADER}\n0,0,0,1,0,0,0\n20,0,0,1,0,0,0`)
    expect(r.available).toBe(false)
    expect(r.rollRmsDeg).toBeNull()
  })
})
