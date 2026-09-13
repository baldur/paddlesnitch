// Origin allowlist for the public, unauthenticated analytics ingest endpoints
// (/att/api/track, and the planned /att/api/behaviour). These accept anonymous
// beacons by design, so there's no auth to lean on — this is a cheap first line
// that drops random/bot pings that don't carry our own origin.
//
// HONEST CEILING: the Origin (and Referer) header is attacker-controlled — a
// script can set `Origin: https://paddlesnitch.com` and sail through. This stops
// casual/drive-by/cross-site-browser noise, NOT a determined spoofer. Real
// integrity would need rate-limiting (CloudFront/WAF) and/or a signed page
// nonce; see docs/features/behavioural-analytics.md. Per the Fetch spec the
// browser always sends Origin on a POST (fetch + sendBeacon), so requiring it
// does not drop legitimate app traffic.

const ALLOWED_ORIGINS = new Set([
  'https://paddlesnitch.com',
  'https://www.paddlesnitch.com',
  // local dev (client beacons are prod-only, but keeps manual testing working)
  'http://localhost:3000',
  'http://localhost:3001',
])

// True when the request carries one of our own origins (via Origin, falling
// back to the Referer's origin). No Origin AND no Referer → rejected: real
// app beacons are POSTs, which always include an Origin header.
export function isAllowedIngestOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (origin) return ALLOWED_ORIGINS.has(origin)
  const referer = req.headers.get('referer')
  if (referer) {
    try { return ALLOWED_ORIGINS.has(new URL(referer).origin) } catch { return false }
  }
  return false
}
