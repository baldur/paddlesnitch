// Fetch a file from a link a user pasted (the trial upload's "paste a link"
// option), without letting that link reach anything internal.
//
// The server Lambda can reach addresses the public can't: the Lambda runtime
// API on 127.0.0.1:9001 and link-local metadata on 169.254.169.254. The old
// fetch took any URL ending in .gpx, followed redirects, had no timeout and
// read any size (security audit 2026-09). Now: https only, no private or
// loopback hosts by name or address, no redirects (a public URL could redirect
// to a private one), a timeout, and a size cap. DNS that resolves a public
// name to a private address is not covered; that would need resolving and
// pinning the address, which isn't worth it for this feature.

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
]

export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false
  if (/^[\d.]+$/.test(host)) return !PRIVATE_V4.some(r => r.test(host))
  if (host.includes(':')) {
    // IPv6 literal: refuse loopback, unspecified, unique-local and link-local.
    return !(host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:'))
  }
  return true
}

export type FetchedFile = { data: ArrayBuffer } | { error: 'not_allowed' | 'fetch_failed' | 'too_large' }

export async function fetchPublicFile(url: string, maxBytes: number, timeoutMs = 10_000): Promise<FetchedFile> {
  if (!isPublicHttpsUrl(url)) return { error: 'not_allowed' }
  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'paddlesnitch.com' },
    })
  } catch {
    return { error: 'fetch_failed' }
  }
  if (!res.ok || !res.body) return { error: 'fetch_failed' }
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) return { error: 'too_large' }

  // Read with a running total: content-length can be absent or wrong.
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return { error: 'too_large' } }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return { data: out.buffer }
}
