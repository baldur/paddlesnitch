// Per-user persistence for saved paddle analyses. Stored under
// analysis/{userId}/{id}/session.json (S3 in prod, .local-data in dev), private
// to the user. Small scale → list = read each session.json, like att entries.
import { nanoid } from 'nanoid'
import { getJson, putJson, listKeys, deleteObject, deleteObjects } from '@paddlesnitch/core/storage'
import { isBoatClass, expectedSeats, BOAT_CLASS_INFO, type BoatClass, type Seat } from '@paddlesnitch/core/types'
import { thumbRoute } from '@paddlesnitch/core/paddles'
import type { AnalysisResult } from './analysis'
import { rescaleDoubling } from './analysis'

export type AnalysisSource = {
  type: 'file' | 'strava' | 'trial' | 'device'
  filename?: string
  stravaActivityId?: number
  sport?: string
  // Set when the paddle was pulled from one of the user's ATT time-trial
  // submissions (#159).
  trialId?: string
  entryId?: string
  courseName?: string
  // Set when the paddle came from one of the user's hardware trackers
  // (docs/features/device-uplink.md).
  deviceId?: string
  deviceSessionId?: string
  deviceName?: string
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
  // Set when the owner opts this paddle into a public, unlisted share link
  // (#202). Anyone with the token can view a read-only copy at
  // /analyse/shared/{shareId}; the owner can revoke it. Absent = private.
  shareId?: string
  // The AI summary hasn't been written yet: the paddle was saved with the plain
  // one so it could open at once (performance.md, phase 4). writePendingSummary
  // (pipeline.ts) writes it and clears this.
  insightPending?: true
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
  // A heavily downsampled [lat,lng] route for the My-Paddles thumbnail — enough
  // to read the shape of the outing at a glance, tiny on the wire. Derived from
  // the already-loaded result points, so it costs no extra storage read.
  route?: [number, number][]
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

// Each paddle also keeps a small summary beside it (summary.json, ~2 KB
// against ~100 KB for the paddle with its map points), so a list reads only
// those: the Paddles page read every paddle in full, twice (6.5 MB for 61).
// Written by saveSession alone: anything writing session.json some other way
// would leave its summary stale (summary-writes.test.ts checks).
const summaryKey = (userId: string, id: string) => `analysis/${userId}/${id}/summary.json`

export async function saveSession(s: AnalysisSession): Promise<void> {
  await putJson(key(s.userId, s.id), s)
  try { await putJson(summaryKey(s.userId, s.id), toSummary(s)) }
  catch (err) {
    // A stale summary is worse than none: without one, the list rebuilds it.
    console.error('[analysis-store] summary write failed', err)
    await deleteObject(summaryKey(s.userId, s.id)).catch(() => {})
  }
}

export async function getSession(userId: string, id: string): Promise<AnalysisSession | null> {
  return getJson<AnalysisSession>(key(userId, id))
}

export async function deleteSession(userId: string, id: string): Promise<void> {
  // Drop the public share index too, so a deleted paddle can't be resolved by a
  // dangling share link.
  const s = await getSession(userId, id)
  if (s?.shareId) await deleteObject(sharedKey(s.shareId))
  await deleteObject(key(userId, id))
  await deleteObject(summaryKey(userId, id))
}

// GDPR erasure: every paddle, the coach profile, and the public share index of
// any shared paddle (it lives outside the user's prefix, so it needs an explicit
// delete or a shared link would keep resolving).
export async function eraseUserAnalysis(userId: string): Promise<void> {
  const shared = (await listSessions(userId)).filter(s => s.shareId).map(s => sharedKey(s.shareId!))
  await deleteObjects([...shared, ...(await listKeys(`analysis/${userId}/`))])
}

// ---- Sharing: an opt-in, unlisted public link for one paddle (#202) ----
// A share index at analysis/shared/{shareId}.json points back at the owning
// user + session, so the public view resolves a paddle from the token alone
// without leaking the userId in the URL.
type ShareIndex = { userId: string; sessionId: string }

const sharedKey = (shareId: string) => `analysis/shared/${shareId}.json`

// Opt a paddle into public sharing and return its (existing or freshly minted)
// share token. Idempotent — a paddle already shared keeps the same token so an
// already-distributed link never breaks.
export async function shareSession(userId: string, id: string): Promise<{ session: AnalysisSession; shareId: string } | null> {
  const s = await getSession(userId, id)
  if (!s) return null
  if (!s.shareId) {
    s.shareId = nanoid()
    await putJson(sharedKey(s.shareId), { userId, sessionId: id } satisfies ShareIndex)
    await saveSession(s)
  }
  return { session: s, shareId: s.shareId }
}

// Revoke a paddle's public link: drop the index and clear the token. Any
// outstanding link stops resolving immediately.
export async function unshareSession(userId: string, id: string): Promise<AnalysisSession | null> {
  const s = await getSession(userId, id)
  if (!s) return null
  if (s.shareId) {
    await deleteObject(sharedKey(s.shareId))
    delete s.shareId
    await saveSession(s)
  }
  return s
}

// Resolve a share token to its paddle for the public read-only view. Returns
// null when the token is unknown OR the session has since been unshared/deleted
// (a stale index whose session no longer bears the token doesn't resolve).
export async function getSharedSession(shareId: string): Promise<AnalysisSession | null> {
  const idx = await getJson<ShareIndex>(sharedKey(shareId))
  if (!idx) return null
  const s = await getSession(idx.userId, idx.sessionId)
  if (!s || s.shareId !== shareId) return null
  return s
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
    // Not for a tracker paddle: its stroke rate comes from the motion data and
    // already counts every stroke, both sides (one-paddle.md, phase 1).
    const doubled = BOAT_CLASS_INFO[bc].sport === 'kayak' && s.source?.type !== 'device'
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
    route: thumbRoute(s.result.points),
  }
}

// All of a user's sessions as summaries, newest paddle first. Reads each
// paddle's small summary.json; a paddle saved before summaries existed is read
// in full once, and its summary written for next time.
export async function listSessionSummaries(userId: string): Promise<SessionSummary[]> {
  const keys = await listKeys(`analysis/${userId}/`)
  const has = new Set(keys)
  const ids = keys.map(k => /^analysis\/[^/]+\/([^/]+)\/session\.json$/.exec(k)?.[1]).filter((x): x is string => !!x)
  const out = await Promise.all(ids.map(async id => {
    if (has.has(summaryKey(userId, id))) {
      const sum = await getJson<SessionSummary>(summaryKey(userId, id)).catch(() => null)
      if (sum) return sum
    }
    const full = await getJson<AnalysisSession>(key(userId, id))
    if (!full) return null
    const sum = toSummary(full)
    await putJson(summaryKey(userId, id), sum).catch(() => {})
    return sum
  }))
  return out.filter((s): s is SessionSummary => !!s).sort((a, b) => (b.paddledAt > a.paddledAt ? 1 : -1))
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
