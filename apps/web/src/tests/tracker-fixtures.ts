// Synthetic tracker files for tests: the motion data (sidecar) and the track
// CSV, shaped as the firmware writes them.

export const HEADER = 'ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps'

/**
 * Synthesises a motion sidecar.
 *
 * `alternating` is the important knob: real paddling swings the boat one way on
 * the left stroke and the other way on the right, so consecutive strokes are
 * mirror images and the waveform repeats over a PAIR. Reproducing that is what
 * makes the doubling test meaningful rather than decorative.
 */
export function sidecar(opts: {
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

// The track CSV as the tracker writes it: millis() and the GPS time per row,
// at 1 Hz, moving at `kmh`.
export function trackCsv(seconds: number, kmh: number, opts: { startMs?: number; t0?: string; marker?: boolean } = {}) {
  const { startMs = 0, t0 = '2026-10-06T09:00:00Z', marker = false } = opts
  const rows = Array.from({ length: seconds }, (_, i) => {
    const ts = new Date(Date.parse(t0) + i * 1000).toISOString().replace('.000Z', 'Z')
    return `${ts},${startMs + i * 1000},1,${(51.5 + i * kmh / 3.6 / 111_000).toFixed(6)},-0.978,${kmh}`
  })
  return [...(marker ? ['<<<CAT /track.csv 1234>>>'] : []), 'timestamp,ms,fix,lat,lon,speed_kmh', ...rows].join('\n')
}

// The same, with the GPS losing the sky `lostAfterS` in: the time and millis()
// carry on, the position and speed are empty from then on (#414).
export function lostTrackCsv(seconds: number, lostAfterS: number, kmh: number, opts: { startMs?: number; t0?: string } = {}) {
  const [header, ...rows] = trackCsv(seconds, kmh, opts).split('\n')
  return [header, ...rows.map((r, i) => (i <= lostAfterS ? r : `${r.split(',').slice(0, 2).join(',')},0,,,`))].join('\n')
}


/**
 * A motion file shaped like a kayak: the hull rocks with an alternating
 * stroke (`strokesPerMin`, default 60), a little further to one side, and the
 * bow pitches. Gravity in the accelerometer, the rates in the gyro, so boat
 * motion (roll, pitch, evenness) has something real to measure. The app
 * contract's boat-motion fixtures are made from it.
 */
export function boatSidecar(seconds: number, hz: number, startMs = 0): string {
  const rows: string[] = []
  let seed = 11
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 2 }
  const P = 1.0, rad = Math.PI / 180
  const roll = (t: number) => { const s = Math.sin(Math.PI * t / P); return (s > 0 ? 9.5 : 7.5) * s * (1 + 0.15 * Math.sin(t / 37)) }
  const pitch = (t: number) => 2.2 * Math.sin(2 * Math.PI * t / P + 0.6) + 0.4 * Math.sin(t / 5)
  for (let i = 0; i < seconds * hz; i++) {
    const t = i / hz, r = roll(t) * rad, p = pitch(t) * rad, dt = 1 / hz
    const gx = (roll(t + dt) - roll(t)) / dt, gy = (pitch(t + dt) - pitch(t)) / dt
    const n = () => 0.01 * rnd()
    rows.push([startMs + Math.round(t * 1000), (-Math.sin(p) + n()).toFixed(4), (Math.sin(r) * Math.cos(p) + n()).toFixed(4), (Math.cos(r) * Math.cos(p) + n()).toFixed(4),
      (gx + rnd()).toFixed(3), (gy + rnd()).toFixed(3), (0.5 * rnd()).toFixed(3)].join(','))
  }
  return [HEADER, ...rows].join('\n')
}
