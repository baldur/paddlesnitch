import { analyseTrack, plainInsight, split500 } from '@paddlesnitch/analysis/analysis'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import sample from './home-sample-paddle.json'

// The paddle on the signed-out front door. It is a real paddle (the Garmin
// export in src/tests/fixtures, a Thames outing at Reading) run through the
// same engine as every paddle, then frozen into home-sample-paddle.json so
// the home page does no parsing or analysis per request. A test re-runs the
// engine over the fixture and checks the JSON still matches.

// r = rest, c = cruising, s = hard effort
export type RouteKind = 'r' | 'c' | 's'
export type SamplePaddle = {
  paddledAt: string
  distanceKm: number
  durationS: number
  pace: string            // cruising pace per 500 m, m:ss (as the paddle view shows it)
  avgSR: number | null    // spm
  efforts: number
  insight: string         // the deterministic template, never an LLM call
  route: [number, number, RouteKind][]
}

const ROUTE_POINTS = 240

export function buildSamplePaddle(track: TrackPoint[]): SamplePaddle {
  const r = analyseTrack(track)
  const kindAt = (t: number): RouteKind =>
    r.stops.some(s => t >= s.fromT && t <= s.toT) ? 'r'
      : r.surges.some(s => t >= s.fromT && t <= s.toT) ? 's' : 'c'
  const step = Math.max(1, Math.ceil(r.points.length / ROUTE_POINTS))
  const pts = r.points.filter((_, i) => i % step === 0 || i === r.points.length - 1)
  return {
    paddledAt: track[0].timestamp.toISOString(),
    distanceKm: Math.round(r.distanceKm * 100) / 100,
    durationS: Math.round(r.durationS),
    pace: split500(r.cruiseSpeed),
    avgSR: r.avgSR == null ? null : Math.round(r.avgSR),
    efforts: r.surges.length,
    insight: plainInsight(r),
    route: pts.map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5, kindAt(p.t)]),
  }
}

export const SAMPLE_PADDLE = sample as SamplePaddle
