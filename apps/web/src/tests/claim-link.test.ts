import { describe, it, expect } from 'vitest'
import { GET } from '@/app/l/[code]/route'

// The claim QR on the device points here. Getting this wrong is invisible on a
// bench and total in the field: the user scans, lands somewhere that does not
// carry their session, and sees a sign-in page instead of their device.
const hit = async (code: string) =>
  GET(new Request(`https://example.invalid/l/${code}`), { params: Promise.resolve({ code }) })

describe('GET /l/:code — the claim QR target', () => {
  it('redirects to settings with the code prefilled', async () => {
    const res = await hit('ABC123')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/profile/me/settings?code=ABC123#devices')
  })

  it('uses a RELATIVE Location so it never leaks the origin it ran on', async () => {
    // Regression: it built an absolute URL from req.url, which behind
    // CloudFront -> Lambda is the Lambda function URL. Users were sent to
    // <hash>.lambda-url.eu-west-1.on.aws, where the paddlesnitch.com auth
    // cookie does not apply -- so a signed-in user arrived signed out.
    const loc = (await hit('ABC123')).headers.get('location') ?? ''
    expect(loc.startsWith('/')).toBe(true)
    expect(loc).not.toContain('lambda-url')
    expect(loc).not.toContain('://')
  })

  it('normalises what a camera hands over', async () => {
    // The device shows uppercase; a scanner may pass anything through.
    expect((await hit('abc123')).headers.get('location')).toContain('code=ABC123')
  })

  it('falls back to the devices section when there is no usable code', async () => {
    expect((await hit('!!!')).headers.get('location')).toBe('/profile/me/settings#devices')
  })
})
