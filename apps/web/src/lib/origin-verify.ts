// Only CloudFront may call the server (#908). The server Lambda has a public
// function URL, so anyone who finds `<id>.lambda-url.eu-west-1.on.aws` could
// call it directly, skipping CloudFront's security headers and caching, and
// setting headers CloudFront normally sets itself (CloudFront-Viewer-*).
// CloudFront adds a secret header on the server origin (infra/lib/att-stack.ts,
// SSM /att/origin-verify) and src/proxy.ts checks it on every request.
//
// ORIGIN_VERIFY_SECRETS: the accepted values, comma-separated ("current" or
//   "current,previous" while rotating). Unset or empty: the check is off (local
//   dev, tests, e2e: nothing in front of Next adds the header).
// ORIGIN_VERIFY_MODE: 'enforce' refuses a request without a right value (403);
//   anything else only logs a warning, so a first deploy can prove CloudFront
//   sends the header before anything is refused.

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify'

export type OriginVerdict = 'off' | 'ok' | 'missing' | 'wrong'

// Same time whatever the input, so a caller can't find the secret a character
// at a time. Plain JS: the proxy may run where node:crypto isn't available.
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i)
  return diff === 0
}

export function originVerdict(value: string | null, secretsEnv = process.env.ORIGIN_VERIFY_SECRETS): OriginVerdict {
  const secrets = (secretsEnv ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (secrets.length === 0) return 'off'
  if (!value) return 'missing'
  let ok = false
  for (const s of secrets) ok = sameString(value, s) || ok
  return ok ? 'ok' : 'wrong'
}

/** True when the request must be refused. Logs (never the value) when it didn't come through CloudFront. */
export function refuseDirectRequest(req: { headers: Headers; method: string }, env: NodeJS.ProcessEnv = process.env): boolean {
  const verdict = originVerdict(req.headers.get(ORIGIN_VERIFY_HEADER), env.ORIGIN_VERIFY_SECRETS)
  if (verdict === 'off' || verdict === 'ok') return false
  const enforce = env.ORIGIN_VERIFY_MODE === 'enforce'
  // A warning, not an error: a stranger calling the function URL is expected,
  // not something we broke (root CLAUDE.md, console.error rule).
  console.warn(JSON.stringify({ msg: 'origin_verify', verdict, method: req.method, refused: enforce }))
  return enforce
}
