// A user's saved paddle, from its stored summary, as the lean PaddleCard the
// Paddles list sends (paddles.list reads the summaries with
// listSessionSummaries, which also fills in old ones).
import { isPhonePaddle, type PaddleCard } from './paddles'
import { isBoatClass } from './types'

// A paddle's small summary (analysis/{userId}/{id}/summary.json, written by
// the analysis store beside each paddle): enough for a card, ~2 KB instead of
// the ~100 KB paddle.
type StoredSummary = {
  id: string; paddledAt: string; source?: { type?: string; deviceId?: string }; boatClass?: unknown
  distanceKm?: number; durationS?: number; cruiseSpeed?: number; avgSR?: number | null; route?: [number, number][]
  note?: string; noGps?: true
}

/** A paddle's stored summary as the lean card the list sends (paddles.list). */
export function summaryToCard(s: StoredSummary): PaddleCard {
  return {
    id: s.id, paddledAt: s.paddledAt,
    distanceKm: s.distanceKm ?? 0, durationS: s.durationS ?? 0, cruiseSpeed: s.cruiseSpeed ?? 0, avgSR: s.avgSR ?? null,
    boatClass: isBoatClass(s.boatClass) ? s.boatClass : undefined,
    sourceType: s.source?.type ?? 'file',
    route: s.route ?? [],
    ...(s.note?.trim() ? { note: s.note } : {}),
    ...(s.noGps ? { noGps: true as const } : {}),
    ...(isPhonePaddle(s.source) ? { phone: true as const } : {}),
  }
}
