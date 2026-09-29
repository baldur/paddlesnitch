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

  it('every behaviour uses it', () => {
    const behaviours = stack.match(/viewerProtocolPolicy: cloudfront\.ViewerProtocolPolicy\.REDIRECT_TO_HTTPS,\n\s*responseHeadersPolicy: securityHeaders,/g) ?? []
    const all = stack.match(/viewerProtocolPolicy: cloudfront\.ViewerProtocolPolicy\.REDIRECT_TO_HTTPS,/g) ?? []
    expect(all.length).toBeGreaterThanOrEqual(6)
    expect(behaviours.length).toBe(all.length)
  })
})
