// Strava OAuth + read-only API wrapper. No SDK — fetch directly.
//
// Token storage is per-user (see putStravaTokens in storage.ts callers).
// The client_secret is sensitive; it lives in SSM Parameter Store in
// production and a local env var in dev, fetched lazily through getClientSecret().

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import type { StravaTokens, StravaActivitySummary } from './types'
import type { TrackPoint } from '@paddlesnitch/timing/types'

const STRAVA_BASE = 'https://www.strava.com'
const API_BASE = `${STRAVA_BASE}/api/v3`

// Refresh if the access token will expire within this many seconds. Strava
// access tokens live 6 h; refreshing slightly early is harmless and keeps us
// off the edge of "expired mid-request".
const REFRESH_LEEWAY_SEC = 120

// Sport types we'll surface in the picker. Strava has fifty-ish; we only care
// about ones a paddler or rower would use for a time trial. If you want to
// import something exotic (e.g. "Workout"), paste the URL on the URL tab.
const WATER_SPORT_TYPES = new Set([
  'Kayaking', 'Canoeing', 'Rowing', 'StandUpPaddling', 'VirtualRow',
])

// Both halves of the Strava OAuth app credential live in SSM. Caching is
// module-level so warm Lambda invocations skip the SSM round-trip; the
// process.env overrides exist for local dev and tests.
let cachedSecret: string | undefined
let cachedClientId: string | undefined

async function fetchSsmParam(paramName: string, decrypt: boolean): Promise<string | undefined> {
  try {
    const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'eu-west-1' })
    const res = await ssm.send(new GetParameterCommand({
      Name: paramName,
      WithDecryption: decrypt,
    }))
    return res.Parameter?.Value
  } catch (err) {
    console.error(`[strava] could not fetch ${paramName} from SSM:`, err)
    return undefined
  }
}

// Strava client secret is 40 lowercase hex chars. SSM SecureString fetches
// without kms:Decrypt permission silently return a ~240-char base64 KMS
// blob starting with "AQICAH" — same shape, very different value. Validate
// so we don't ship that to Strava and so we don't poison the cache.
const STRAVA_SECRET_FORMAT = /^[0-9a-f]{40}$/

async function getClientSecret(): Promise<string | undefined> {
  const direct = process.env.STRAVA_CLIENT_SECRET
  if (direct) return direct
  if (cachedSecret) return cachedSecret
  const paramName = process.env.STRAVA_CLIENT_SECRET_PARAM
  if (!paramName) return undefined
  const value = await fetchSsmParam(paramName, true)
  if (value && !STRAVA_SECRET_FORMAT.test(value)) {
    // The blob shape ("AQICAH..." 240+ chars) is the standard tell that SSM
    // returned undecrypted ciphertext. Don't cache it — next call retries
    // and a transient IAM fix takes effect immediately.
    const looksLikeCiphertext = value.startsWith('AQICAH') && value.length > 100
    console.error(`[strava] SSM returned a value that does not look like a Strava secret (len=${value.length}, ciphertext-shaped=${looksLikeCiphertext}). Refusing to cache.`)
    return undefined
  }
  cachedSecret = value
  return cachedSecret
}

async function getClientId(): Promise<string | undefined> {
  const direct = process.env.STRAVA_CLIENT_ID
  if (direct) return direct
  if (cachedClientId) return cachedClientId
  const paramName = process.env.STRAVA_CLIENT_ID_PARAM
  if (!paramName) return undefined
  cachedClientId = await fetchSsmParam(paramName, false)
  return cachedClientId
}

// Build the Strava authorize URL that the user is sent to. `state` is the
// CSRF token the caller has stored in a cookie; the callback verifies it.
//
// We always request `profile:read_all` so we can read the user's verified
// Strava email via /api/v3/athlete. The link flow doesn't strictly need
// it, but the sign-in flow does, and asking for the wider scope once is
// cleaner than maintaining two consent screens for the same user.
//
// `prompt` controls Strava's `approval_prompt` query param:
//   - 'auto'  — skip the consent screen if the user has already authorized
//               the app. Smooth UX but BROKEN if the previously-approved
//               scopes are a subset of what we ask for now: Strava issues
//               a new token with the *old* (narrower) scopes silently.
//   - 'force' — always show the consent screen. One extra click per call,
//               but the token always reflects the current scope set.
//
// Sign-in needs 'force' so a user whose existing token lacks
// `profile:read_all` gets re-prompted and the new token includes the
// email-bearing scope. Link can keep 'auto' since it doesn't depend on
// the email field.
export async function authorizeUrl(
  state: string,
  redirectUri: string,
  prompt: 'auto' | 'force' = 'auto',
): Promise<string | null> {
  const clientId = await getClientId()
  if (!clientId) return null
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: prompt,
    scope: 'read,activity:read_all,profile:read_all',
    state,
  })
  return `${STRAVA_BASE}/oauth/authorize?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete?: { id: number; firstname?: string; lastname?: string }
}

// Exchange an authorization code for an initial token pair. Called once per
// connect; throws on any failure since there's nothing the caller can do
// other than show "connect failed, try again".
//
// Strava's /oauth/token endpoint expects form-encoded data, not JSON. Sending
// JSON returns 401 with no useful body. Don't change the encoding without
// verifying against a real Strava response.
export async function exchangeCode(code: string): Promise<StravaTokens> {
  const [clientId, clientSecret] = await Promise.all([getClientId(), getClientSecret()])
  if (!clientId || !clientSecret) throw new Error('strava_not_configured')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  })
  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    // Strava's error response carries useful detail (e.g. invalid_grant,
    // invalid_client). Surface the first ~400 chars in the thrown error so
    // CloudWatch logs tell us why instead of just the status code.
    const errBody = await res.text().catch(() => '')
    throw new Error(`strava_exchange_failed_${res.status}: ${errBody.slice(0, 400)}`)
  }
  const tokenBody = (await res.json()) as TokenResponse
  const athlete = tokenBody.athlete
  const name = [athlete?.firstname, athlete?.lastname].filter(Boolean).join(' ').trim() || 'Strava athlete'
  return {
    athleteId: athlete?.id ?? 0,
    athleteName: name,
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token,
    expiresAt: tokenBody.expires_at,
  }
}

// Refresh the access token if it's expired or about to expire. Returns the
// (possibly updated) tokens — caller is responsible for persisting them if
// `expiresAt` changed.
export async function refreshIfExpired(tokens: StravaTokens): Promise<StravaTokens> {
  const now = Math.floor(Date.now() / 1000)
  if (tokens.expiresAt - now > REFRESH_LEEWAY_SEC) return tokens

  const [clientId, clientSecret] = await Promise.all([getClientId(), getClientSecret()])
  if (!clientId || !clientSecret) throw new Error('strava_not_configured')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  })
  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`strava_refresh_failed_${res.status}: ${errBody.slice(0, 400)}`)
  }
  const tokenBody = (await res.json()) as TokenResponse
  return {
    ...tokens,
    accessToken: tokenBody.access_token,
    refreshToken: tokenBody.refresh_token,
    expiresAt: tokenBody.expires_at,
  }
}

// Fetch the authenticated athlete's verified profile. Token exchange returns
// athlete data but NOT the email — that requires a separate /api/v3/athlete
// call with the profile:read_all scope. Used by the sign-in flow to find or
// create the matching Cognito user. Returns null if anything goes wrong;
// the caller decides whether to surface an error.
export type StravaAthleteProfile = {
  id: number
  email: string                // may be empty if Strava hasn't surfaced one
  firstname: string
  lastname: string
}

export async function getAthleteProfile(accessToken: string): Promise<StravaAthleteProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/athlete`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      console.error(`[strava] getAthleteProfile failed: HTTP ${res.status}`)
      return null
    }
    const body = (await res.json()) as { id: number; email?: string; firstname?: string; lastname?: string }
    return {
      id: body.id,
      email: body.email ?? '',
      firstname: body.firstname ?? '',
      lastname: body.lastname ?? '',
    }
  } catch (err) {
    console.error('[strava] getAthleteProfile threw:', err)
    return null
  }
}

// Best-effort revoke. Strava 401s if the token is already invalid — we treat
// that as success since the goal (no usable token on either side) is met.
export async function revoke(accessToken: string): Promise<void> {
  try {
    await fetch(`${STRAVA_BASE}/oauth/deauthorize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    console.warn('[strava] revoke failed (already invalid?):', err)
  }
}

type RawActivity = {
  id: number
  name: string
  sport_type?: string
  type?: string
  start_date: string
  distance: number          // metres
  moving_time: number       // seconds
}

// Most recent activities first, one page at a time (Strava is paginated). The
// picker shows a page, then a "get more" control fetches older pages. `hasMore`
// is derived from the RAW (pre-filter) page being full, so a page that's all
// bike rides doesn't falsely end paging — there may be water sports further back.
export async function listActivities(
  accessToken: string,
  page = 1,
  perPage = 30,
): Promise<{ activities: StravaActivitySummary[]; hasMore: boolean }> {
  const res = await fetch(`${API_BASE}/athlete/activities?per_page=${perPage}&page=${page}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`strava_list_failed_${res.status}`)
  const raw = (await res.json()) as RawActivity[]
  const activities = raw
    .map((a): StravaActivitySummary => ({
      id: a.id,
      name: a.name,
      sportType: a.sport_type ?? a.type ?? '',
      startDate: a.start_date,
      distanceMetres: a.distance,
      movingSeconds: a.moving_time,
    }))
    // Drop activities Strava marked as a non-water sport so the picker isn't
    // 80% bike rides. The user can still import via URL if they want one.
    .filter(a => WATER_SPORT_TYPES.has(a.sportType))
  return { activities, hasMore: raw.length === perPage }
}

type StreamSet = {
  latlng?: { data: [number, number][] }
  time?: { data: number[] }
}

// Pull lat/lng + time streams for one activity. Returns null if Strava sent
// nothing useful back (private activity without permission, no GPS, etc).
export async function getActivityStreams(accessToken: string, activityId: number): Promise<{
  latlng: [number, number][]
  time: number[]
  startDate: string
} | null> {
  const [streamsRes, summaryRes] = await Promise.all([
    fetch(`${API_BASE}/activities/${activityId}/streams?keys=latlng,time&key_by_type=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch(`${API_BASE}/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ])
  if (!streamsRes.ok || !summaryRes.ok) return null
  const streams = (await streamsRes.json()) as StreamSet
  const summary = (await summaryRes.json()) as { start_date: string }
  if (!streams.latlng?.data?.length || !streams.time?.data?.length) return null
  return {
    latlng: streams.latlng.data,
    time: streams.time.data,
    startDate: summary.start_date,
  }
}

// Build a TrackPoint[] from the parallel Strava arrays. Strava's `time` is
// seconds-from-start; we add startDate to get absolute Date timestamps, matching
// what gpx.ts / fit.ts produce.
export function streamsToTrack(
  latlng: [number, number][],
  time: number[],
  startDate: string,
): TrackPoint[] {
  const start = new Date(startDate).getTime()
  const n = Math.min(latlng.length, time.length)
  const out: TrackPoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = {
      lat: latlng[i][0],
      lng: latlng[i][1],
      timestamp: new Date(start + time[i] * 1000),
    }
  }
  return out
}
