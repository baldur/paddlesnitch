// Unit tests for the email-forwarder Lambda's pure helpers. The
// SES + S3 round trips are covered by manual smoke after deploy; what
// matters here is that we don't mangle the original sender's email
// when we rewrite the MIME envelope.
import { describe, it, expect } from 'vitest'
import { __test__ } from '../../../../infra/lambdas/email-forwarder/index.mjs'

const { parseHeaders, buildForwardedMime } = __test__

describe('parseHeaders', () => {
  it('extracts From / Subject / Date from a typical email', () => {
    const raw = [
      'From: Alice <alice@example.com>',
      'To: privacy@paddlesnitch.com',
      'Subject: GDPR data access request',
      'Date: Mon, 1 Jul 2026 10:00:00 +0000',
      'Message-ID: <abc123@example.com>',
      '',
      'Hi, please send me my data.',
    ].join('\r\n')
    const headers = parseHeaders(raw)
    expect(headers.from).toBe('Alice <alice@example.com>')
    expect(headers.subject).toBe('GDPR data access request')
    expect(headers.date).toBe('Mon, 1 Jul 2026 10:00:00 +0000')
    expect(headers['message-id']).toBe('<abc123@example.com>')
  })

  it('unfolds continuation lines (RFC 5322 folded headers)', () => {
    // A long Subject can be wrapped onto multiple lines; the
    // continuation starts with whitespace.
    const raw = [
      'From: someone@example.com',
      'Subject: This is a very long subject',
      '\tthat continues on the next line',
      '',
      'body',
    ].join('\r\n')
    const headers = parseHeaders(raw)
    expect(headers.subject).toBe('This is a very long subject that continues on the next line')
  })

  it('treats headers case-insensitively', () => {
    const raw = ['FROM: x@y.com', 'SUBJECT: hi', '', 'body'].join('\r\n')
    expect(parseHeaders(raw).from).toBe('x@y.com')
    expect(parseHeaders(raw).subject).toBe('hi')
  })

  it('returns an empty object for malformed input', () => {
    expect(parseHeaders('').from).toBeUndefined()
    expect(parseHeaders('no colons here\r\n').from).toBeUndefined()
  })
})

describe('buildForwardedMime', () => {
  const headers = {
    from: 'Alice <alice@example.com>',
    subject: 'Test subject',
    date: 'Mon, 1 Jul 2026 10:00:00 +0000',
  }
  const rawBody = 'Hi, please action my GDPR request.'

  it('rewrites From to the SES-verified noreply address', () => {
    const mime = buildForwardedMime({ headers, rawBody, originalRaw: '' })
    expect(mime).toMatch(/^From: noreply@paddlesnitch\.com/m)
  })

  it('sets Reply-To to the original sender so replies go back to them', () => {
    const mime = buildForwardedMime({ headers, rawBody, originalRaw: '' })
    expect(mime).toMatch(/^Reply-To: Alice <alice@example\.com>/m)
  })

  it('prefixes the subject with the configured tag', () => {
    const mime = buildForwardedMime({ headers, rawBody, originalRaw: '' })
    expect(mime).toMatch(/^Subject: \[paddlesnitch\] Test subject/m)
  })

  it('preserves the original body inside the forwarded message', () => {
    const mime = buildForwardedMime({ headers, rawBody, originalRaw: '' })
    expect(mime).toContain(rawBody)
  })

  it('falls back to From when Reply-To is missing on the original', () => {
    const mime = buildForwardedMime({ headers: { from: 'x@y.com' }, rawBody, originalRaw: '' })
    expect(mime).toMatch(/^Reply-To: x@y\.com/m)
  })

  it('omits Reply-To if neither Reply-To nor From is present', () => {
    const mime = buildForwardedMime({ headers: {}, rawBody, originalRaw: '' })
    expect(mime).not.toMatch(/^Reply-To:/m)
  })

  it('handles a missing subject gracefully', () => {
    const mime = buildForwardedMime({ headers: { from: 'x@y.com' }, rawBody, originalRaw: '' })
    expect(mime).toMatch(/^Subject: \[paddlesnitch\] \(no subject\)/m)
  })
})
