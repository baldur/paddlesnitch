// Does a request's If-None-Match cover this ETag? HTTP compares If-None-Match
// weakly (RFC 9110 §13.1.2): `W/"v"` matches `"v"`, and the header can list
// several tags or be `*`. An exact string compare failed in production once a
// hop between us and the browser weakened the tag (CloudFront does when it
// compresses), so every repeat view was sent in full.
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (t: string) => t.trim().replace(/^W\//, '')
  if (ifNoneMatch.trim() === '*') return true
  return ifNoneMatch.split(',').some(t => opaque(t) === opaque(etag))
}
