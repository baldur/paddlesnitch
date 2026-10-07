// Every CloudFront behaviour sends the security headers (security audit
// 2026-09: the site sent none, so e.g. the account-delete page could be framed).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const stack = readFileSync(path.resolve(__dirname, '../../../../infra/lib/att-stack.ts'), 'utf8')

describe('security headers', () => {
  it('the policy sets HSTS, frame DENY, nosniff and a referrer policy', () => {
    expect(stack).toMatch(/strictTransportSecurity:/)
    expect(stack).toMatch(/HeadersFrameOption\.DENY/)
    expect(stack).toMatch(/contentTypeOptions:/)
    expect(stack).toMatch(/HeadersReferrerPolicy\.STRICT_ORIGIN_WHEN_CROSS_ORIGIN/)
  })

  // The built-files policy (asset-caching.test.ts) adds Cache-Control on top
  // of the same shared security headers, so it counts too.
  it('every behaviour uses it', () => {
    const behaviours = stack.match(/viewerProtocolPolicy: cloudfront\.ViewerProtocolPolicy\.REDIRECT_TO_HTTPS,\n\s*responseHeadersPolicy: (securityHeaders|immutableAssetHeaders),/g) ?? []
    const all = stack.match(/viewerProtocolPolicy: cloudfront\.ViewerProtocolPolicy\.REDIRECT_TO_HTTPS,/g) ?? []
    expect(all.length).toBeGreaterThanOrEqual(6)
    expect(behaviours.length).toBe(all.length)
  })

  it('every response headers policy carries the one shared set', () => {
    const policies = stack.match(/new cloudfront\.ResponseHeadersPolicy\(/g)?.length ?? 0
    const sharing = stack.match(/\n\s*securityHeadersBehavior,\n/g)?.length ?? 0
    expect(policies).toBeGreaterThanOrEqual(2)
    expect(sharing).toBe(policies)
  })
})
