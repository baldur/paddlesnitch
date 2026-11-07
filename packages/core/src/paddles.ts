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
  note?: string               // the owner's diary note, when there is one
  noGps?: true                // a paddle without a map (#414): draw no route
  // The same outing recorded by another source, shown once under this card
  // (see groupSameOuting). Set only by paddles.list.
  sameOuting?: { id: string; sourceType: string; phone?: true }[]
  phone?: true                // a 'device' paddle recorded on a phone with the app (C3), not a tracker
}

/** A phone on the account (C3): `P` and 16 hex digits. Pure, so browser code
 *  can use it; same rule as isPhoneId in core/devices (phone-recording.test.ts
 *  checks). */
export const isPhoneDeviceId = (deviceId: unknown): boolean => typeof deviceId === 'string' && /^P[0-9A-F]{16}$/.test(deviceId)

/** A 'device' paddle from a phone rather than a tracker: both are devices on
 *  the account and share the source shape, so the device ID tells them apart.
 *  Views for others and the apps get `phone: true` instead (no device ID). */
export const isPhonePaddle = (source: { type?: string; deviceId?: string; phone?: boolean } | undefined): boolean =>
  source?.phone === true || (source?.type === 'device' && isPhoneDeviceId(source.deviceId))

const ALSO_RECORDED_BY: Record<string, string> = { device: 'the tracker', strava: 'Strava', trial: 'a time trial', file: 'a file' }

/** Another recording of the same outing, as "Also recorded by …" names it (list and paddle page; mobile/contract/README.md quotes it). */
export const alsoRecordedBy = (source: { type?: string; deviceId?: string; phone?: boolean }): string =>
  isPhonePaddle(source) ? 'the phone' : ALSO_RECORDED_BY[source.type ?? ''] ?? 'a file'

/** The paddle's source with `phone: true` added for a phone, so a reader
 *  without the device ID (a buddy, a share link, the apps) can say Phone. */
export function markPhone<S extends { type?: string; deviceId?: string; phone?: true }>(source: S): S {
  return isPhonePaddle(source) ? { ...source, phone: true as const } : source
}

// ≤24 evenly-spaced [lat,lng] points, rounded to ~1 m, for a list thumbnail.
export function thumbRoute(points: { lat: number; lng: number }[]): [number, number][] {
  if (points.length < 2) return []
  const step = Math.max(1, Math.ceil(points.length / 24))
  return points.filter((_, i) => i % step === 0)
    .map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5] as [number, number])
}

// ---- Paddles without a map (#414) ----
// A tracker paddle whose GPS failed: time paddling, stroke rate, strokes and
// boat motion from the motion data, but no route, distance, speed or pace. It
// counts towards the paddle count, time on the water and streaks; it adds
// nothing to km; it is never offered for compare, sections or similar paddles.
// Marked by `noGps` on the paddle's result, its summary and anything built
// from them. Test with this, never with distance or points.
export function isMotionOnly(p: { noGps?: unknown } | null | undefined): boolean {
  return !!p?.noGps
}

/** What a paddle adds to km totals: nothing for a paddle without a map. */
const kmOf = (p: { distanceKm: number; noGps?: unknown }) => (isMotionOnly(p) ? 0 : p.distanceKm || 0)

/** A paddle's own distance as shown: "—" for a paddle without a map, never "0 km". */
export function paddleKm(p: { distanceKm: number; noGps?: unknown }, dp = 2): string {
  return isMotionOnly(p) ? '—' : `${p.distanceKm.toFixed(dp)} km`
}

export type PaddleTotals = { count: number; totalKm: number; totalS: number; since: string | null }

// Roll a paddler's saved paddles up into the headline totals shown on the
// signed-in home / dashboard. Tolerates missing distance/duration (no NaN).
export function paddleTotals(paddles: { distanceKm: number; durationS: number; paddledAt: string; noGps?: unknown }[]): PaddleTotals {
  let totalKm = 0, totalS = 0, since: string | null = null
  for (const p of paddles) {
    totalKm += kmOf(p)
    totalS += p.durationS || 0
    if (p.paddledAt && (since === null || p.paddledAt < since)) since = p.paddledAt
  }
  return { count: paddles.length, totalKm, totalS, since }
}

// ---- The logbook on /paddles (site review, 2026-10) ----
// Pure, from the fields every paddle summary has, so the list can show volume
// and habit rather than only totals.

type Dated = { paddledAt: string; distanceKm: number; durationS: number; noGps?: unknown }
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
    if (i >= 0 && i < weeks) out[i].km += kmOf(p)
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
    if (pk === k) thisMonth += kmOf(p)
    else if (pk === k - 1) lastMonth += kmOf(p)
  }
  return { thisMonth: Math.round(thisMonth * 10) / 10, lastMonth: Math.round(lastMonth * 10) / 10 }
}

export type Logbook = {
  weeks: { week: string; km: number }[]   // last 12 weeks, oldest first, this week last
  streakWeeks: number
  thisMonthKm: number
  lastMonthKm: number
}

/** The logbook at the top of the Paddles list, worked out once for the web and the apps. */
export function paddleLogbook(paddles: Dated[], now: Date): Logbook {
  const month = monthKm(paddles, now)
  return { weeks: weeklyKm(paddles, now), streakWeeks: weekStreak(paddles, now), thisMonthKm: month.thisMonth, lastMonthKm: month.lastMonth }
}

// ---- One outing recorded twice (#852) ----
// The one rule for "same outing", on the Paddles list, the paddle page and
// Compare: the two overlap in time by at least half the shorter one, AND at
// the minutes both recorded they put the paddler within CORRIDOR_M of each
// other at least MIN_AGREEMENT of the time. Two people out at the same time on
// another river, or a phone left on the bank, are not the same outing.
// The place part reads `places`, worked out from the track when the paddle is
// saved and kept in its small summary, so a list never reads a track.

/** The shorter paddle must lie at least this much inside the other in time... */
export const MIN_TIME_OVERLAP = 0.5
/** ...and at least this share of the minutes both recorded must put the two within CORRIDOR_M. */
export const MIN_AGREEMENT = 0.7
export const CORRIDOR_M = 40
/** `places` holds one position per this many seconds of clock time. */
export const PLACES_EVERY_S = 60

/** Where a paddle was at each whole minute of clock time (UTC) it recorded:
 *  `from` is the first such minute in epoch seconds, then one [lat, lng] a minute. */
export type OutingPlaces = { from: number; pts: [number, number][] }

type Window = { paddledAt: string; durationS: number }
const startMs = (p: { paddledAt: string }) => Date.parse(p.paddledAt)

/** Seconds both paddles were recording, over the shorter one's duration. */
export function timeOverlapShare(a: Window, b: Window): number {
  const from = Math.max(startMs(a), startMs(b))
  const to = Math.min(startMs(a) + a.durationS * 1000, startMs(b) + b.durationS * 1000)
  const shorter = Math.min(a.durationS, b.durationS)
  return shorter > 0 ? Math.max(0, to - from) / 1000 / shorter : 0
}

// Metres between two nearby points (flat-earth: exact enough at 40 m).
const metresApart = ([la, na]: [number, number], [lb, nb]: [number, number]) =>
  Math.hypot((lb - la) * 110_540, (nb - na) * 111_320 * Math.cos(((la + lb) / 2) * Math.PI / 180))

/** Share of the minutes both recorded that put the two within CORRIDOR_M;
 *  null when they share fewer than three minutes. */
export function placesAgreement(a: OutingPlaces, b: OutingPlaces): number | null {
  const from = Math.max(a.from, b.from)
  const to = Math.min(a.from + (a.pts.length - 1) * PLACES_EVERY_S, b.from + (b.pts.length - 1) * PLACES_EVERY_S)
  let n = 0, near = 0
  for (let s = from; s <= to; s += PLACES_EVERY_S) {
    const pa = a.pts[(s - a.from) / PLACES_EVERY_S], pb = b.pts[(s - b.from) / PLACES_EVERY_S]
    if (!pa || !pb) continue
    n++
    if (metresApart(pa, pb) <= CORRIDOR_M) near++
  }
  return n >= 3 ? near / n : null
}

/** What the rule needs of a paddle: a summary, a card with places, or a full paddle's parts. */
export type Outing = Window & { noGps?: unknown; places?: OutingPlaces }

/** Two recordings are one outing: they overlap in time and in place. */
export function sameOuting(a: Outing, b: Outing): boolean {
  // A paddle without a map (#414) is never offered to compare with another.
  if (isMotionOnly(a) || isMotionOnly(b)) return false
  if (timeOverlapShare(a, b) < MIN_TIME_OVERLAP) return false
  if (!a.places || !b.places) return false
  const agreement = placesAgreement(a.places, b.places)
  return agreement != null && agreement >= MIN_AGREEMENT
}

/**
 * Recordings of one outing from two sources (the tracker and a watch on
 * Strava) as one group, so the list shows the outing once (`sameOuting` is the
 * rule). The tracker's copy leads (it has the boat motion), then Strava, then
 * the rest; the list stays newest first.
 */
export function groupSameOuting<T extends Dated & Outing & { source: { type: string; deviceId?: string; phone?: boolean } }>(paddles: T[]): { lead: T; others: T[] }[] {
  // A tracker, fixed in the boat, leads over a phone (#789).
  const rank = (s: T['source']) => ['device', 'strava', 'trial', 'file'].indexOf(s.type) * 2 + (isPhonePaddle(s) ? 1 : 0)
  const groups: T[][] = []
  for (const p of paddles) {
    const g = groups.find(g => g.some(q => sameOuting(p, q)))
    if (g) g.push(p); else groups.push([p])
  }
  return groups.map(g => {
    const sorted = [...g].sort((a, b) => rank(a.source) - rank(b.source))
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
  const thisYearKm = paddles.filter(p => new Date(p.paddledAt).getUTCFullYear() === year).reduce((s, p) => s + kmOf(p), 0)
  const longest = paddles.filter(p => !isMotionOnly(p)).reduce<T | null>((b, p) => (!b || p.distanceKm > b.distanceKm ? p : b), null)
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
