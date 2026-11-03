import type { RollHistogram } from '@paddlesnitch/timing/attitude'

// The boat-motion charts' y-axis ticks, shared with the apps through
// mobile/contract/format/format.json: every multiple of the step within
// ±maxDeg, so the ticks are symmetric and none falls outside the chart.
export function axisTicks(maxDeg: number): number[] {
  const step = maxDeg > 12 ? 5 : maxDeg > 6 ? 3 : 2
  const top = Math.floor(maxDeg / step) * step
  const ticks: number[] = []
  for (let v = -top; v <= top; v += step) ticks.push(v === 0 ? 0 : v)
  return ticks
}

// The "Through the session" chart's x labels for a recording `ms` long: whole
// minutes, or seconds under two minutes (a 20 s recording read "0 min … 0 min").
export function envelopeXLabels(ms: number): [string, string] {
  return ms < 120_000 ? ['0 s', `${Math.round(ms / 1000)} s`] : ['0 min', `${Math.round(ms / 60_000)} min`]
}

// The roll histogram's x range, ± this many degrees: half a bin past the
// outermost bin centre, so the edge bars sit inside the frame. At least 1°.
export function histogramHalfRangeDeg(h: RollHistogram): number {
  return Math.max(...h.bins.map(b => Math.abs(b.centreDeg) + h.binWidthDeg / 2), 1)
}
