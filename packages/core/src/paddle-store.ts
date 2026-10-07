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

// A paddle's small summary (analysis/{userId}/{id}/summary.json, written by
// the analysis store beside each paddle): enough for a card, ~2 KB instead of
// the ~100 KB paddle.
type StoredSummary = {
  id: string; paddledAt: string; source?: { type?: string }; boatClass?: unknown
  distanceKm?: number; durationS?: number; cruiseSpeed?: number; avgSR?: number | null; route?: [number, number][]
}

function summaryToCard(s: StoredSummary): PaddleCard {
  return {
    id: s.id, paddledAt: s.paddledAt,
    distanceKm: s.distanceKm ?? 0, durationS: s.durationS ?? 0, cruiseSpeed: s.cruiseSpeed ?? 0, avgSR: s.avgSR ?? null,
    boatClass: isBoatClass(s.boatClass) ? s.boatClass : undefined,
    sourceType: s.source?.type ?? 'file',
    route: s.route ?? [],
  }
}

// A user's saved paddles as lean cards, newest paddle first. Reads each
// paddle's summary where there is one, the full paddle otherwise.
export async function listPaddleCards(userId: string): Promise<PaddleCard[]> {
  const keys = await listKeys(`analysis/${userId}/`)
  const has = new Set(keys)
  const cards = await Promise.all(keys.filter(k => k.endsWith('/session.json')).map(async k => {
    const sumKey = k.replace(/session\.json$/, 'summary.json')
    if (has.has(sumKey)) {
      const sum = await getJson<StoredSummary>(sumKey).catch(() => null)
      if (sum?.id) return summaryToCard(sum)
    }
    const full = await getJson<StoredSession>(k)
    return full?.id ? toCard(full) : null
  }))
  return cards.filter((c): c is PaddleCard => !!c).sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : -1))
}
