// Per-user persistence for saved paddle analyses. Stored under
// analysis/{userId}/{id}/session.json (S3 in prod, .local-data in dev), private
// to the user. Small scale → list = read each session.json, like att entries.
import { getJson, putJson, listKeys, deleteObject } from '@paddlesnitch/core/storage'
import { isBoatClass, expectedSeats, BOAT_CLASS_INFO, type BoatClass, type Seat } from '@paddlesnitch/core/types'
import type { AnalysisResult } from './analysis'
import { rescaleDoubling } from './analysis'

export type AnalysisSource = {
  type: 'file' | 'strava' | 'trial'
  filename?: string
  stravaActivityId?: number
  sport?: string
  // Set when the paddle was pulled from one of the user's ATT time-trial
  // submissions (#159).
  trialId?: string
  entryId?: string
  courseName?: string
}

export type AnalysisSession = {
  id: string
  userId: string
  createdAt: string          // when the analysis was run
  paddledAt: string          // the session's own start time (for diary ordering)
  source: AnalysisSource
  doubleStrokeRate: boolean
  note: string               // the paddler's diary text
  insight: string            // the (LLM or templated) narrative
  result: AnalysisResult     // full derived analysis, incl. downsampled map points
  boatClass?: BoatClass      // the type of outing (K1, 2X, 8+, …) — paddler-set
  seat?: Seat                // which seat they were in (1 = bow, N = stroke, 'C' = cox)
}

// Compact shape for the library list + the history digest fed back to the LLM.
export type SessionSummary = {
  id: string
  createdAt: string
  paddledAt: string
  source: AnalysisSource
  durationS: number
  distanceKm: number
  avgSR: number | null
  cruiseSpeed: number
  effortCount: number
  avgDps: number | null
  note: string
  insight: string
  boatClass?: BoatClass
  seat?: Seat
  // Start point of the track — used by relevance retrieval to group paddles by
  // venue ("your other paddles here"). Undefined on a paddle with no points.
  startLat?: number
  startLng?: number
}

const key = (userId: string, id: string) => `analysis/${userId}/${id}/session.json`

// A stable identity for a paddle so re-submitting the same trace is recognised as
// a duplicate (#178). Derived only from fields every session already stores
// (paddledAt + duration + distance), so it also fingerprints PRE-EXISTING
// sessions with no migration. The same file re-uploaded — or the same Strava
// activity re-imported — analyses to the same start time, duration, and distance,
// so it collapses to the same fingerprint regardless of source. Distance is
// rounded to whole metres and duration to whole seconds to absorb float noise.
export function paddleFingerprint(paddledAt: string, durationS: number, distanceKm: number): string {
  return `${paddledAt}|${Math.round(durationS)}|${Math.round(distanceKm * 1000)}`
}

// The user's existing paddle matching this fingerprint, if any. Newest first, so
// a re-submission points at the most recent copy.
export async function findDuplicateSession(userId: string, fingerprint: string): Promise<SessionSummary | null> {
  const existing = await listSessionSummaries(userId)
  return existing.find(s => paddleFingerprint(s.paddledAt, s.durationS, s.distanceKm) === fingerprint) ?? null
}

export async function saveSession(s: AnalysisSession): Promise<void> {
  await putJson(key(s.userId, s.id), s)
}

export async function getSession(userId: string, id: string): Promise<AnalysisSession | null> {
  return getJson<AnalysisSession>(key(userId, id))
}

export async function deleteSession(userId: string, id: string): Promise<void> {
  await deleteObject(key(userId, id))
}

export async function updateSessionNote(userId: string, id: string, note: string): Promise<AnalysisSession | null> {
  const s = await getSession(userId, id)
  if (!s) return null
  s.note = note
  await saveSession(s)
  return s
}

// Flip the SUP→kayak stroke-rate doubling on a saved paddle and re-persist. The
// result's SR-derived fields are rescaled in place (no re-analysis needed).
export async function updateSessionDoubling(userId: string, id: string, doubled: boolean): Promise<AnalysisSession | null> {
  const s = await getSession(userId, id)
  if (!s) return null
  s.result = rescaleDoubling(s.result, doubled)
  s.doubleStrokeRate = doubled
  await saveSession(s)
  return s
}

// Sanitise a boat-class + seat pair. A valid class is required; the seat is kept
// only when it's a real seat for THAT class (via expectedSeats), otherwise
// dropped. No/invalid class → no boat at all. Pure, so it's unit-tested directly.
export function resolveBoat(boatClass: unknown, seat: unknown): { boatClass?: BoatClass; seat?: Seat } {
  if (!isBoatClass(boatClass)) return {}
  const seatOk = seat === 'C' || (typeof seat === 'number' && Number.isInteger(seat) && seat >= 1)
  if (seatOk && expectedSeats(boatClass).includes(seat as Seat)) return { boatClass, seat: seat as Seat }
  return { boatClass }
}

// Set the type of outing + which seat the paddler was in, and re-persist. A boat
// update replaces the whole (class, seat) pair; a null/invalid class clears both.
// Picking a boat class also sets the SUP→kayak stroke-rate doubling: a kayak
// class (K1/K2/K4) counts stroke rate per full cycle, so it's doubled; a rowing
// class isn't. The manual ×2 toggle can still override afterwards.
export async function updateSessionBoat(userId: string, id: string, boatClass: unknown, seat: unknown): Promise<AnalysisSession | null> {
  const s = await getSession(userId, id)
  if (!s) return null
  const { boatClass: bc, seat: st } = resolveBoat(boatClass, seat)
  if (bc) {
    s.boatClass = bc
    if (st !== undefined) s.seat = st; else delete s.seat
    const doubled = BOAT_CLASS_INFO[bc].sport === 'kayak'
    if (s.result.strokeRateDoubled !== doubled) s.result = rescaleDoubling(s.result, doubled)
    s.doubleStrokeRate = doubled
  } else { delete s.boatClass; delete s.seat }
  await saveSession(s)
  return s
}

function toSummary(s: AnalysisSession): SessionSummary {
  return {
    id: s.id, createdAt: s.createdAt, paddledAt: s.paddledAt, source: s.source,
    durationS: s.result.durationS, distanceKm: s.result.distanceKm,
    avgSR: s.result.avgSR, cruiseSpeed: s.result.cruiseSpeed,
    effortCount: s.result.surges.length, avgDps: s.result.avgDps, note: s.note, insight: s.insight,
    boatClass: s.boatClass, seat: s.seat,
    startLat: s.result.points[0]?.lat, startLng: s.result.points[0]?.lng,
  }
}

// All of a user's sessions as summaries, newest paddle first.
export async function listSessionSummaries(userId: string): Promise<SessionSummary[]> {
  return (await listSessions(userId)).map(toSummary).sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : -1))
}

// All of a user's sessions in full (incl. `result.points`), unordered. Heavier
// than the summaries — used by the similar-sections matcher, which needs every
// paddle's track. Small scale (a user's own paddles), so read-all is fine.
export async function listSessions(userId: string): Promise<AnalysisSession[]> {
  const keys = (await listKeys(`analysis/${userId}/`)).filter(k => k.endsWith('session.json'))
  return (await Promise.all(keys.map(k => getJson<AnalysisSession>(k)))).filter((s): s is AnalysisSession => !!s)
}

// ---- Athlete profile: a persistent, distilled "who is this paddler" memory ----
// Stored once per user at analysis/{userId}/profile.json, private to the user.
// A compact natural-language blurb (built + updated by the LLM layer from the
// paddler's history + diary notes) that feeds the per-paddle insight prompt at a
// CONSTANT token cost regardless of how many paddles they have. See
// docs/features/personable-insights.md.
export type AthleteProfile = {
  text: string          // the ~200-token natural-language memory
  updatedAt: string     // ISO — when last built/merged
  builtFromCount: number // paddle count at the last FULL re-distill (drift control)
}

const profileKey = (userId: string) => `analysis/${userId}/profile.json`

export async function getAthleteProfile(userId: string): Promise<AthleteProfile | null> {
  return getJson<AthleteProfile>(profileKey(userId))
}

export async function saveAthleteProfile(userId: string, profile: AthleteProfile): Promise<void> {
  await putJson(profileKey(userId), profile)
}
