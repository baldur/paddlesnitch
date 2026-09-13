// Server-only reader for a user's saved Analyse paddles, so the platform app
// can render the paddle dashboard for a signed-in visitor without importing
// analysis-app code. Reads the same store the Analyse app writes
// (analysis/{userId}/{id}/session.json) and projects each to a lean PaddleCard.
// Small scale (a user's own paddles) → read-each, like att entries.
import { getJson, listKeys } from './storage'
import { thumbRoute, type PaddleCard } from './paddles'
import { isBoatClass } from './types'

// Only the fields we project from — the Analyse app owns the full schema.
type StoredSession = {
  id: string
  paddledAt: string
  source?: { type?: string }
  boatClass?: unknown
  result?: {
    distanceKm?: number
    durationS?: number
    cruiseSpeed?: number
    avgSR?: number | null
    points?: { lat: number; lng: number }[]
  }
}

function toCard(s: StoredSession): PaddleCard {
  const r = s.result ?? {}
  return {
    id: s.id,
    paddledAt: s.paddledAt,
    distanceKm: r.distanceKm ?? 0,
    durationS: r.durationS ?? 0,
    cruiseSpeed: r.cruiseSpeed ?? 0,
    avgSR: r.avgSR ?? null,
    boatClass: isBoatClass(s.boatClass) ? s.boatClass : undefined,
    sourceType: s.source?.type ?? 'file',
    route: thumbRoute(r.points ?? []),
  }
}

// A user's saved paddles as lean cards, newest paddle first.
export async function listPaddleCards(userId: string): Promise<PaddleCard[]> {
  const keys = (await listKeys(`analysis/${userId}/`)).filter(k => k.endsWith('session.json'))
  const sessions = (await Promise.all(keys.map(k => getJson<StoredSession>(k)))).filter((s): s is StoredSession => !!s && !!s.id)
  return sessions.map(toCard).sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : -1))
}
