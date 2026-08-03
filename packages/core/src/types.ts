// Platform identity + Strava plumbing types shared across apps.

export type AuthUser = {
  id: string
  email: string
  displayName: string
}

// Persisted per-user at users/{userId}/strava.json. Consumers should call
// getValidStravaTokens(), which refreshes if expiresAt is close, so the
// returned accessToken is safe to send to Strava immediately.
export type StravaTokens = {
  athleteId: number
  athleteName: string
  accessToken: string
  refreshToken: string
  // Unix seconds, matches Strava's expires_at field.
  expiresAt: number
}

// Trimmed slice of the Strava activity payload — only the fields the picker
// renders. Full Strava payload is huge; we don't store it.
export type StravaActivitySummary = {
  id: number
  name: string
  // sport_type on new activities, falling back to type. We normalise.
  sportType: string
  startDate: string             // ISO 8601, includes zone
  distanceMetres: number
  movingSeconds: number
}

// Boat classes — shared across apps (att entries + analysis paddles). Captured
// per upload/paddle. `seat` records which position the paddler was in.
export type KayakClass = 'K1' | 'K2' | 'K4'
export type SculClass  = '1X' | '2X' | '4X+' | '4X-'
export type SweepClass = '2-' | '4+' | '4-' | '8+'
export type BoatClass  = KayakClass | SculClass | SweepClass

export const BOAT_CLASSES: BoatClass[] = [
  'K1', 'K2', 'K4',
  '1X', '2X', '4X+', '4X-',
  '2-', '4+', '4-', '8+',
]

export const BOAT_CLASS_INFO: Record<BoatClass, {
  sport: 'kayak' | 'rowing'
  crewSize: number   // number of paddlers/rowers (does NOT include cox)
  hasCox: boolean
}> = {
  K1:   { sport: 'kayak',  crewSize: 1, hasCox: false },
  K2:   { sport: 'kayak',  crewSize: 2, hasCox: false },
  K4:   { sport: 'kayak',  crewSize: 4, hasCox: false },
  '1X': { sport: 'rowing', crewSize: 1, hasCox: false },
  '2X': { sport: 'rowing', crewSize: 2, hasCox: false },
  '4X+':{ sport: 'rowing', crewSize: 4, hasCox: true },
  '4X-':{ sport: 'rowing', crewSize: 4, hasCox: false },
  '2-': { sport: 'rowing', crewSize: 2, hasCox: false },
  '4+': { sport: 'rowing', crewSize: 4, hasCox: true },
  '4-': { sport: 'rowing', crewSize: 4, hasCox: false },
  '8+': { sport: 'rowing', crewSize: 8, hasCox: true },
}

export function isBoatClass(value: unknown): value is BoatClass {
  return typeof value === 'string' && (BOAT_CLASSES as string[]).includes(value)
}

// A seat in a boat. 1 = bow, N = stroke, 'C' = cox.
export type Seat = number | 'C'

export type CrewMember = {
  name: string
  seat: Seat
}

// Returns the full list of seat slots for a boat class. Used by both UI
// (to render the right number of rows) and validation (to check completeness).
export function expectedSeats(boatClass: BoatClass): Seat[] {
  const info = BOAT_CLASS_INFO[boatClass]
  const seats: Seat[] = Array.from({ length: info.crewSize }, (_, i) => i + 1)
  if (info.hasCox) seats.push('C')
  return seats
}

// A human label for a seat. Rowing uses bow/stroke; kayak uses front/back
// (a K4 reads front, 2, 3, back). Middle seats are just their number.
export function seatLabel(boatClass: BoatClass, seat: Seat): string {
  if (seat === 'C') return 'cox'
  const info = BOAT_CLASS_INFO[boatClass]
  if (info.crewSize === 1) return 'single'
  const kayak = info.sport === 'kayak'
  if (seat === 1) return kayak ? 'front' : 'bow (1)'
  if (seat === info.crewSize) return kayak ? 'back' : `stroke (${seat})`
  return String(seat)
}

// Validates a crew list against a boat class. Returns null if valid, error string otherwise.
export function validateCrew(boatClass: BoatClass, crew: CrewMember[]): string | null {
  const expected = expectedSeats(boatClass)
  if (crew.length !== expected.length) {
    return `${boatClass} needs ${expected.length} crew member${expected.length === 1 ? '' : 's'}, got ${crew.length}`
  }
  const seatsSeen = new Set<Seat>()
  for (const m of crew) {
    if (!m.name || !m.name.trim()) return 'All crew members need a name'
    if (!expected.includes(m.seat)) return `Seat ${m.seat} is not valid for ${boatClass}`
    if (seatsSeen.has(m.seat)) return `Seat ${m.seat} listed more than once`
    seatsSeen.add(m.seat)
  }
  return null
}
