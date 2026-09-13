// Shared, client-safe paddle helpers used by BOTH apps: the Analyse library +
// dashboard, and the platform home (which mirrors the paddle dashboard for a
// signed-in visitor). Pure — no storage import — so it's safe in a client
// bundle. The storage-backed reader lives in `paddle-store.ts` (server only).
import type { BoatClass } from './types'

// The minimal shape a paddle card / stat strip needs. A projection of the
// Analyse app's richer AnalysisSession, kept here so the platform app can render
// the same cards without importing analysis-app code.
export type PaddleCard = {
  id: string
  paddledAt: string
  distanceKm: number
  durationS: number
  cruiseSpeed: number
  avgSR: number | null
  boatClass?: BoatClass
  sourceType: string          // 'file' | 'strava' | 'trial' | 'device'
  route: [number, number][]   // ≤24 [lat,lng] points for the thumbnail
}

// ≤24 evenly-spaced [lat,lng] points, rounded to ~1 m, for a list thumbnail.
export function thumbRoute(points: { lat: number; lng: number }[]): [number, number][] {
  if (points.length < 2) return []
  const step = Math.max(1, Math.ceil(points.length / 24))
  return points.filter((_, i) => i % step === 0)
    .map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5] as [number, number])
}

export type PaddleTotals = { count: number; totalKm: number; totalS: number; since: string | null }

// Roll a paddler's saved paddles up into the headline totals shown on the
// signed-in home / dashboard. Tolerates missing distance/duration (no NaN).
export function paddleTotals(paddles: { distanceKm: number; durationS: number; paddledAt: string }[]): PaddleTotals {
  let totalKm = 0, totalS = 0, since: string | null = null
  for (const p of paddles) {
    totalKm += p.distanceKm || 0
    totalS += p.durationS || 0
    if (p.paddledAt && (since === null || p.paddledAt < since)) since = p.paddledAt
  }
  return { count: paddles.length, totalKm, totalS, since }
}
