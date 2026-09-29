import type { NextRequest } from 'next/server'

// Behind CloudFront + Lambda Function URL, req.url's host resolves to the
// raw Function URL (xxxx.lambda-url.eu-west-1.on.aws), not paddlesnitch.com.
// Any redirect built with `new URL(..., req.url)` would therefore send the
// user to the function URL — visible in their address bar and unstable.
// For server-built absolute URLs (Strava redirect_uri, OAuth callbacks,
// confirmation emails, etc.) always derive the base from this helper.
export function canonicalBaseUrl(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL
  if (fromEnv) return fromEnv
  return req.nextUrl.origin
}

// Where to send someone after sign-in. `next` arrives in the URL, so it may
// only be a path on this site. "//evil.com" and "/\\evil.com" start with "/" but
// browsers treat them as another site, and whitespace or control characters
// get stripped by browsers before they parse the URL.
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  if (/[\s\x00-\x1f\\]/.test(next.slice(0, 3))) return fallback
  return next
}
