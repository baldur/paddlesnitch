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
// the clock instants both recorded (every PLACES_EVERY_S, at least three) they
// put the paddler within CORRIDOR_M of each other at least MIN_AGREEMENT of the
// time. Two people out at the same time on another river, or a phone left on
// the bank, are not the same outing.
// The place part reads `places`, worked out from the track when the paddle is
// saved and kept in its small summary, so a list never reads a track.

/** The shorter paddle must lie at least this much inside the other in time... */
export const MIN_TIME_OVERLAP = 0.5
/** ...and at least this share of the instants both recorded must put the two within CORRIDOR_M. */
export const MIN_AGREEMENT = 0.7
export const CORRIDOR_M = 40
/** At least this many shared instants, or there is nothing to judge by. */
export const MIN_SAMPLES = 3
/** `places` holds one position per this many seconds of clock time (UTC). */
export const PLACES_EVERY_S = 20
/** No position at an instant whose two nearest points are further apart than
 *  this: a straight line across a gap can cut a bend. */
export const MAX_GAP_S = 30

/**
 * Where a paddle was at each instant of clock time that is a multiple of
 * `every` seconds (epoch), from `from`. Compact: `d` is [lat, lng] pairs in
 * 1e-5 degrees (~1 m), the first absolute and each later one the change since
 * the last position; null, null where there is none (a gap).
 */
export type OutingPlaces = { from: number; every: number; d: (number | null)[] }

/** Positions ([lat, lng] in degrees, or null for none) as OutingPlaces. */
export function encodePlaces(from: number, every: number, pts: ([number, number] | null)[]): OutingPlaces {
  const d: (number | null)[] = []
  let last: [number, number] = [0, 0]
  for (const p of pts) {
    if (!p) { d.push(null, null); continue }
    const q: [number, number] = [Math.round(p[0] * 1e5), Math.round(p[1] * 1e5)]
    d.push(q[0] - last[0], q[1] - last[1])
    last = q
  }
  return { from, every, d }
}

/** Places in the shape this code writes (anything else, such as an older
 *  draft's `{ from, pts }`, counts as none and is rebuilt). */
export function hasPlaces(p: unknown): p is OutingPlaces {
  const q = p as Partial<OutingPlaces> | null | undefined
  return typeof q?.from === 'number' && typeof q.every === 'number' && q.every > 0 && Array.isArray(q.d)
}

/** OutingPlaces back to positions in degrees (null where there is none). */
export function decodePlaces(p: OutingPlaces): ([number, number] | null)[] {
  if (!hasPlaces(p)) return []
  const out: ([number, number] | null)[] = []
  let lat = 0, lng = 0
  for (let i = 0; i + 1 < p.d.length; i += 2) {
    const a = p.d[i], b = p.d[i + 1]
    if (a == null || b == null) { out.push(null); continue }
    lat += a; lng += b
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

type Window = { paddledAt: string; durationS: number }
const startMs = (p: { paddledAt: string }) => Date.parse(p.paddledAt)

/** Seconds both paddles were recording, over the shorter one's duration. */
export function timeOverlapShare(a: Window, b: Window): number {
  const from = Math.max(startMs(a), startMs(b))
  const to = Math.min(startMs(a) + a.durationS * 1000, startMs(b) + b.durationS * 1000)
  const shorter = Math.min(a.durationS, b.durationS)
  return shorter > 0 ? Math.max(0, to - from) / 1000 / shorter : 0
}

/** For each paddle (by index), the others it overlaps in time by at least
 *  MIN_TIME_OVERLAP. Sorted by start, so each is checked only against those
 *  that start before it ends: about linear for a real list. */
export function overlapsInTime(items: Window[]): number[][] {
  const span = items.map((p, i) => ({ i, s: startMs(p), e: startMs(p) + p.durationS * 1000 })).sort((a, b) => a.s - b.s)
  const out = items.map(() => [] as number[])
  for (let x = 0; x < span.length; x++) {
    for (let y = x + 1; y < span.length && span[y].s < span[x].e; y++) {
      const i = span[x].i, j = span[y].i
      if (timeOverlapShare(items[i], items[j]) >= MIN_TIME_OVERLAP) { out[i].push(j); out[j].push(i) }
    }
  }
  return out
}

// Metres between two nearby points (flat-earth: exact enough at 40 m).
const metresApart = ([la, na]: [number, number], [lb, nb]: [number, number]) =>
  Math.hypot((lb - la) * 110_540, (nb - na) * 111_320 * Math.cos(((la + lb) / 2) * Math.PI / 180))

export type OutingGap = { samples: number; medianM: number; worstM: number; agreement: number }

/**
 * How far apart the two put the paddler at the instants both recorded.
 * `worstM` is the 95th percentile (one wild fix shouldn't define it);
 * `agreement` the share within CORRIDOR_M. Null under MIN_SAMPLES instants.
 */
export function placesGap(a: OutingPlaces, b: OutingPlaces): OutingGap | null {
  const pa = decodePlaces(a), pb = decodePlaces(b)
  const gaps: number[] = []
  for (let i = 0; i < pa.length; i++) {
    const j = (a.from + i * a.every - b.from) / b.every
    const x = pa[i], y = Number.isInteger(j) ? pb[j] : undefined
    if (x && y) gaps.push(metresApart(x, y))
  }
  if (gaps.length < MIN_SAMPLES) return null
  const s = [...gaps].sort((x, y) => x - y)
  return {
    samples: gaps.length,
    medianM: Math.round(s[Math.floor(s.length / 2)]),
    worstM: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]),
    agreement: gaps.filter(g => g <= CORRIDOR_M).length / gaps.length,
  }
}

/** What the rule needs of a paddle: a summary, or a full paddle's parts. */
export type Outing = Window & { noGps?: unknown; places?: OutingPlaces }

/** Two recordings are one outing: they overlap in time and in place. */
export function sameOuting(a: Outing, b: Outing): boolean {
  // A paddle without a map (#414) is never offered to compare with another.
  if (isMotionOnly(a) || isMotionOnly(b)) return false
  if (timeOverlapShare(a, b) < MIN_TIME_OVERLAP) return false
  if (!hasPlaces(a.places) || !hasPlaces(b.places)) return false
  const gap = placesGap(a.places, b.places)
  return !!gap && gap.agreement >= MIN_AGREEMENT
}

/**
 * Recordings of one outing from two sources (the tracker and a watch on
 * Strava) as one group, so the list shows the outing once. The tracker's copy
 * leads (it has the boat motion), then Strava, then the rest. A recording
 * joins a group only if it is the same outing as that group's LEAD, so a card's
 * "Also recorded by" always matches a link on the lead's page, and the answer
 * doesn't depend on the order of the list. Groups keep the list's order.
 */
export function groupSameOuting<T extends Dated & Outing & { id?: string; source: { type: string; deviceId?: string; phone?: boolean } }>(paddles: T[]): { lead: T; others: T[] }[] {
  // A tracker, fixed in the boat, leads over a phone (#789).
  const rank = (s: T['source']) => ['device', 'strava', 'trial', 'file'].indexOf(s.type) * 2 + (isPhonePaddle(s) ? 1 : 0)
  const order = paddles.map((_, i) => i).sort((x, y) => {
    const a = paddles[x], b = paddles[y]
    return rank(a.source) - rank(b.source) || startMs(a) - startMs(b) || (a.id ?? '').localeCompare(b.id ?? '') || x - y
  })
  const pos = new Map(order.map((i, k) => [i, k]))
  const near = overlapsInTime(paddles)
  const groups = new Map<number, number[]>()      // lead's index -> members, lead first
  for (const i of order) {
    const lead = near[i].filter(j => groups.has(j)).sort((x, y) => pos.get(x)! - pos.get(y)!).find(j => sameOuting(paddles[j], paddles[i]))
    if (lead === undefined) groups.set(i, [i]); else groups.get(lead)!.push(i)
  }
  return [...groups.values()]
    .sort((g, h) => Math.min(...g) - Math.min(...h))
    .map(([lead, ...others]) => ({ lead: paddles[lead], others: others.map(i => paddles[i]) }))
}

/** The other recordings a paddle's page links to, by the list's grouping: a
 *  lead's others, or a member's lead. */
export function sameOutingLinks<T extends { id: string }>(groups: { lead: T; others: T[] }[], id: string): T[] {
  for (const g of groups) {
    if (g.lead.id === id) return g.others
    if (g.others.some(o => o.id === id)) return [g.lead]
  }
  return []
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
