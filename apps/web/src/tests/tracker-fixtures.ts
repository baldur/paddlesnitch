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

