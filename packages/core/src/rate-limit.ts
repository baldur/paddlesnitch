// A fixed-window rate limiter over the object store.
//
// Scope, stated up front so nobody mistakes this for more than it is: this is a
// SPEED BUMP for the two unauthenticated device endpoints, not a WAF. It stops a
// script hammering `/api/devices/claim` from filling the bucket with claim
// records; it does not stop a distributed attacker, and it is not a defence
// against brute force (the claim secret is 32 random bytes — brute force is not
// the threat model, storage and cost are).
//
// Two honest limitations:
//
//   1. **The increment is not atomic.** There is no compare-and-swap in the
//      storage abstraction, so two requests landing in the same instant can both
//      read the same count and one write is lost. A serial poller (which is what
//      the device is) is counted exactly; a parallel attacker undercounts and so
//      gets somewhat more than the limit. Bounding the damage roughly is the
//      goal; precise accounting would need DynamoDB conditional writes or
//      ElastiCache, which is the "real store" the spec defers to.
//
//   2. **It fails OPEN.** A storage error means the request is allowed. Getting
//      locked out of onboarding because of a transient S3 blip is a worse
//      failure than serving one extra request — this guards cost, not secrets.
//
// Fixed window rather than sliding: a sliding window needs the timestamps of
// every hit, which is more storage and more reads for a bound that does not need
// to be that sharp. The cost of a fixed window is that a caller can use its full
// allowance at the end of one window and again at the start of the next.
import { getJson, putJson } from './storage'

export type RateLimitResult = {
  allowed: boolean
  /** Requests used in the current window, including this one when allowed. */
  count: number
  limit: number
  /** Seconds until the current window rolls over — served as Retry-After. */
  resetInSeconds: number
}

// Keys live under their own prefix so a lifecycle rule can expire them; they are
// worthless the moment their window closes.
const key = (bucket: string, windowStart: number) => `rate/${bucket}/${windowStart}.json`

/**
 * Count one hit against `bucket` and say whether it is allowed.
 *
 * `bucket` must already be a safe path segment — callers build it from a
 * validated deviceId or a sanitised IP, never from raw input.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(now / windowMs) * windowMs
  const resetInSeconds = Math.ceil((windowStart + windowMs - now) / 1000)

  try {
    const rec = await getJson<{ count?: number }>(key(bucket, windowStart))
    const count = (rec?.count ?? 0) + 1
    if (count > limit) {
      // Deliberately does NOT write: once over the limit there is nothing to
      // learn from counting higher, and not writing means a flood costs one
      // read rather than a read and a write.
      return { allowed: false, count: count - 1, limit, resetInSeconds }
    }
    await putJson(key(bucket, windowStart), { count })
    return { allowed: true, count, limit, resetInSeconds }
  } catch {
    // Fail open — see the note above.
    return { allowed: true, count: 0, limit, resetInSeconds }
  }
}

/** A client IP reduced to a safe key segment, or null when there isn't one.
 *
 *  `x-forwarded-for` is a comma-separated chain and only the FIRST entry is the
 *  client as CloudFront saw it; the rest are hops and are trivially spoofed by
 *  the caller. Behind CloudFront + a Lambda function URL that first entry is the
 *  one we can rely on, so it is the only one used. */
export function clientIpKey(req: Request): string | null {
  const raw = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!raw) return null
  // IPv6 contains colons, which are legal in S3 keys but awkward in local file
  // paths, so normalise to something safe on both backends.
  const safe = raw.replace(/[^0-9a-fA-F.:]/g, '').replace(/[.:]/g, '_')
  return safe.length >= 3 && safe.length <= 64 ? safe : null
}
