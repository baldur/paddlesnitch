import { NextResponse } from 'next/server'
import { rateLimit, clientIpKey } from '@paddlesnitch/core/rate-limit'

// Rate limits for the two UNAUTHENTICATED device endpoints.
//
// **Every number here is derived from the firmware's actual behaviour, not
// picked.** The spec (docs/features/device-ota-and-auth.md, Part 1 item 4)
// suggested 30/hour per device on `/token`; applying that would have broken
// onboarding. `uplinkClaim()` in firmware/src/uplink.cpp polls `/token` on a
// `delay(5000)` loop for `timeoutMs` (default 300000), so ONE legitimate claim
// attempt is ~60 requests in five minutes. A 30/hour cap locks the device out
// two and a half minutes into its own five-minute window, and the failure would
// have looked like "the code expired" — a bug that costs an afternoon.
//
// So the limits below allow several full claim rounds and still cut off a script.
// They are a cost and storage guard, NOT a brute-force defence: the claim secret
// is 32 random bytes, so guessing it was never the threat.

const HOUR = 3600

/** `/api/devices/claim` — one request per claim attempt. A user who fumbles
 *  onboarding (reset, retry, wrong WiFi) legitimately makes several. */
export const CLAIM_PER_DEVICE = 10
/** Per IP, which is the limit that actually bounds an attacker minting claim
 *  records for invented device IDs. One household onboarding devices sits far
 *  under this; a script does not. */
export const CLAIM_PER_IP = 30
/** `/api/devices/token` — 60 polls per five-minute round, so this is five full
 *  rounds plus headroom. */
export const TOKEN_PER_DEVICE = 300

export type LimitOutcome = { limited: false } | { limited: true; response: Response }

// 429 + Retry-After. The device does not read this header today (it treats a
// non-200/202/410 as a retry, which is the right default), but a limiter that
// does not say when to come back is a limiter nobody can integrate against.
function tooMany(resetInSeconds: number): Response {
  return NextResponse.json(
    { error: 'rate_limited', retryAfterSeconds: resetInSeconds },
    { status: 429, headers: { 'Retry-After': String(resetInSeconds) } },
  )
}

/** Limit `/api/devices/claim` by device AND by IP. `deviceId` must already be
 *  validated by the caller — it becomes part of a storage key. */
export async function limitClaim(req: Request, deviceId: string): Promise<LimitOutcome> {
  const perDevice = await rateLimit(`claim/device/${deviceId}`, CLAIM_PER_DEVICE, HOUR)
  if (!perDevice.allowed) return { limited: true, response: tooMany(perDevice.resetInSeconds) }

  const ip = clientIpKey(req)
  // No usable IP (local dev, or a proxy that dropped the header) → the
  // per-device limit above is the only one that applies. Better than inventing
  // a shared "unknown" bucket, which would make every local device compete for
  // one allowance.
  if (!ip) return { limited: false }

  const perIp = await rateLimit(`claim/ip/${ip}`, CLAIM_PER_IP, HOUR)
  if (!perIp.allowed) return { limited: true, response: tooMany(perIp.resetInSeconds) }
  return { limited: false }
}

/** Limit `/api/devices/token` per device. No IP limit: the device polls this
 *  60 times per round, and an IP cap low enough to matter would be lower than
 *  legitimate use by two devices onboarding behind one router. */
export async function limitTokenPoll(deviceId: string): Promise<LimitOutcome> {
  const r = await rateLimit(`token/device/${deviceId}`, TOKEN_PER_DEVICE, HOUR)
  return r.allowed ? { limited: false } : { limited: true, response: tooMany(r.resetInSeconds) }
}
