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

// The " · SOURCE" tag after a paddle's date. One wording for every list and
// view (it was an inline switch copied into four files). A plain file upload
// needs no tag.
export function sourceLabel(type: string | undefined): string {
  switch (type) {
    case 'strava': return ' · STRAVA'
    case 'trial': return ' · TIME TRIAL'
    case 'device': return ' · TRACKER'
    default: return ''
  }
}

// ---- The logbook on /paddles (site review, 2026-10) ----
// Pure, from the fields every paddle summary has, so the list can show volume
// and habit rather than only totals.

type Dated = { paddledAt: string; distanceKm: number; durationS: number }
const DAY_MS = 86_400_000

/** Monday 00:00 UTC of the week `d` falls in. */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7          // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
}

/** Kilometres per week for the last `weeks` weeks, oldest first, this week last. */
export function weeklyKm(paddles: Dated[], now: Date, weeks = 12): { week: string; km: number }[] {
  const last = weekStart(now).getTime()
  const out = Array.from({ length: weeks }, (_, i) => ({ week: new Date(last - (weeks - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10), km: 0 }))
  for (const p of paddles) {
    const w = weekStart(new Date(p.paddledAt)).getTime()
    const i = weeks - 1 - Math.round((last - w) / (7 * DAY_MS))
    if (i >= 0 && i < weeks) out[i].km += p.distanceKm || 0
  }
  return out.map(o => ({ ...o, km: Math.round(o.km * 10) / 10 }))
}

/**
 * Weeks in a row with at least one paddle, counting back from this week (or
 * from last week, so a streak isn't broken on a Monday morning).
 */
export function weekStreak(paddles: Dated[], now: Date): number {
  const weeks = new Set(paddles.map(p => weekStart(new Date(p.paddledAt)).getTime()))
  let w = weekStart(now).getTime()
  if (!weeks.has(w)) w -= 7 * DAY_MS
  let n = 0
  while (weeks.has(w)) { n++; w -= 7 * DAY_MS }
  return n
}

/** Kilometres this calendar month and last (UTC). */
export function monthKm(paddles: Dated[], now: Date): { thisMonth: number; lastMonth: number } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  const key = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
  const k = y * 12 + m
  let thisMonth = 0, lastMonth = 0
  for (const p of paddles) {
    const pk = key(new Date(p.paddledAt))
    if (pk === k) thisMonth += p.distanceKm || 0
    else if (pk === k - 1) lastMonth += p.distanceKm || 0
  }
  return { thisMonth: Math.round(thisMonth * 10) / 10, lastMonth: Math.round(lastMonth * 10) / 10 }
}

/**
 * Recordings of one outing from two sources (the tracker and a watch on
 * Strava) as one group, so the list shows the outing once. Overlapping by at
 * least half the shorter one in time is enough here: two of YOUR paddles at
 * the same time are the same outing. The tracker's copy leads (it has the
 * boat motion), then Strava, then the rest; the list stays newest first.
 */
export function groupSameOuting<T extends Dated & { source: { type: string } }>(paddles: T[]): { lead: T; others: T[] }[] {
  const rank = (t: string) => ['device', 'strava', 'trial', 'file'].indexOf(t)
  const start = (p: T) => Date.parse(p.paddledAt)
  const overlaps = (a: T, b: T) => {
    const from = Math.max(start(a), start(b)), to = Math.min(start(a) + a.durationS * 1000, start(b) + b.durationS * 1000)
    const shorter = Math.min(a.durationS, b.durationS)
    return shorter > 0 && (to - from) / 1000 >= shorter * 0.5
  }
  const groups: T[][] = []
  for (const p of paddles) {
    const g = groups.find(g => g.some(q => overlaps(p, q)))
    if (g) g.push(p); else groups.push([p])
  }
  return groups.map(g => {
    const sorted = [...g].sort((a, b) => rank(a.source.type) - rank(b.source.type))
    return { lead: sorted[0], others: sorted.slice(1) }
  })
}

/**
 * A paddler's year at a glance, for their own profile: how far this year, the
 * longest paddle and the fastest cruise (each with its id, to link to it),
 * and the weekly streak. Pure.
 */
export function paddlingSummary<T extends Dated & { id: string; cruiseSpeed: number }>(paddles: T[], now: Date): {
  count: number
  thisYearKm: number
  longest: { id: string; km: number; paddledAt: string } | null
  fastest: { id: string; cruiseSpeed: number; paddledAt: string } | null
  streak: number
} {
  const year = now.getUTCFullYear()
  const thisYearKm = paddles.filter(p => new Date(p.paddledAt).getUTCFullYear() === year).reduce((s, p) => s + (p.distanceKm || 0), 0)
  const longest = paddles.reduce<T | null>((b, p) => (!b || p.distanceKm > b.distanceKm ? p : b), null)
  const moving = paddles.filter(p => p.cruiseSpeed > 0.2)
  const fastest = moving.reduce<T | null>((b, p) => (!b || p.cruiseSpeed > b.cruiseSpeed ? p : b), null)
  return {
    count: paddles.length,
    thisYearKm: Math.round(thisYearKm * 10) / 10,
    longest: longest ? { id: longest.id, km: longest.distanceKm, paddledAt: longest.paddledAt } : null,
    fastest: fastest ? { id: fastest.id, cruiseSpeed: fastest.cruiseSpeed, paddledAt: fastest.paddledAt } : null,
    streak: weekStreak(paddles, now),
  }
}
