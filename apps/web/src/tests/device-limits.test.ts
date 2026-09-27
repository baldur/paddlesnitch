// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { rateLimit, clientIpKey } from '@paddlesnitch/core/rate-limit'
import { CLAIM_PER_DEVICE, CLAIM_PER_IP, TOKEN_PER_DEVICE } from '@/lib/device-limits'
import { createClaim } from '@/lib/devices'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks(); vi.useRealTimers() })

const DEVICE = '5A43CA48'

const claimReq = (deviceId = DEVICE, ip?: string) =>
  new Request('http://x/api/devices/claim', {
    method: 'POST',
    body: JSON.stringify({ deviceId, model: 'm', firmware: 'f' }),
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
  })

const tokenReq = (secret: string, deviceId = DEVICE) =>
  new Request('http://x/api/devices/token', {
    method: 'POST',
    body: JSON.stringify({ deviceId, claimSecret: secret }),
    headers: { 'content-type': 'application/json' },
  })

describe('rateLimit (fixed window over the object store)', () => {
  it('allows up to the limit then refuses, and reports when to retry', async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await rateLimit('t/a', 3, 3600)
      expect(r.allowed).toBe(true)
      expect(r.count).toBe(i)
    }
    const over = await rateLimit('t/a', 3, 3600)
    expect(over.allowed).toBe(false)
    expect(over.resetInSeconds).toBeGreaterThan(0)
    expect(over.resetInSeconds).toBeLessThanOrEqual(3600)
  })

  it('counts each bucket separately, so one device cannot exhaust another', async () => {
    await rateLimit('t/a', 1, 3600)
    expect((await rateLimit('t/a', 1, 3600)).allowed).toBe(false)
    expect((await rateLimit('t/b', 1, 3600)).allowed).toBe(true)
  })

  it('rolls over into the next window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'))
    await rateLimit('t/roll', 1, 3600)
    expect((await rateLimit('t/roll', 1, 3600)).allowed).toBe(false)
    vi.setSystemTime(new Date('2026-09-27T11:00:01Z'))
    expect((await rateLimit('t/roll', 1, 3600)).allowed).toBe(true)
  })

  it('fails OPEN when storage throws — a blip must not brick onboarding', async () => {
    // Point DATA_DIR at a path that cannot be written, so getJson/putJson throw.
    const saved = process.env.DATA_DIR
    process.env.DATA_DIR = '/dev/null/nope'
    try {
      const r = await rateLimit('t/broken', 1, 3600)
      expect(r.allowed).toBe(true)
    } finally {
      process.env.DATA_DIR = saved
    }
  })

  it('takes only the first x-forwarded-for entry, since the rest are caller-supplied', () => {
    // CloudFront appends the real client; anything before it was sent by the
    // caller and is trivially spoofed.
    expect(clientIpKey(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } })))
      .toBe('203_0_113_5')
    expect(clientIpKey(new Request('http://x'))).toBeNull()
    // Nothing that could escape a storage key survives.
    expect(clientIpKey(new Request('http://x', { headers: { 'x-forwarded-for': '../../etc/passwd' } })))
      .not.toContain('/')
  })
})

describe('POST /api/devices/claim rate limit', () => {
  it(`allows ${CLAIM_PER_DEVICE} claims per device per hour, then 429s with Retry-After`, async () => {
    for (let i = 0; i < CLAIM_PER_DEVICE; i++) {
      expect((await claim(claimReq())).status).toBe(200)
    }
    const res = await claim(claimReq())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limited')
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('rejects a malformed deviceId BEFORE spending anyone\'s allowance', async () => {
    // Otherwise a script could exhaust a real device's quota by sending junk, or
    // worse, write limiter keys built from unvalidated input.
    for (let i = 0; i < CLAIM_PER_DEVICE + 5; i++) {
      expect((await claim(claimReq('not-a-device'))).status).toBe(400)
    }
    // The real device is untouched.
    expect((await claim(claimReq())).status).toBe(200)
  })

  it('limits by IP as well, so inventing device IDs does not buy unlimited claims', async () => {
    const ip = '203.0.113.9'
    let refusedAt = -1
    // Each request uses a DIFFERENT deviceId, so the per-device limit never
    // fires — only the per-IP one can stop this.
    for (let i = 0; i < CLAIM_PER_IP + 2; i++) {
      const id = (0x5a430000 + i).toString(16).toUpperCase().padStart(8, '0')
      const res = await claim(claimReq(id, ip))
      if (res.status === 429) { refusedAt = i; break }
    }
    expect(refusedAt).toBe(CLAIM_PER_IP)
  })

  it('does not put every local device in one bucket when there is no IP header', async () => {
    // Local dev and tests have no x-forwarded-for. Sharing one "unknown" bucket
    // would make two devices compete for a single allowance.
    for (let i = 0; i < CLAIM_PER_IP + 2; i++) {
      const id = (0x5a440000 + i).toString(16).toUpperCase().padStart(8, '0')
      expect((await claim(claimReq(id))).status).toBe(200)
    }
  })
})

describe('POST /api/devices/token rate limit', () => {
  it('survives a full real claim round — 60 polls in five minutes', async () => {
    // THE REGRESSION THIS NUMBER EXISTS TO PREVENT. uplinkClaim() polls on a
    // delay(5000) loop for timeoutMs (default 300000), so one legitimate
    // onboarding attempt is ~60 requests. The spec suggested 30/hour, which
    // would lock the device out halfway through its own window and present as
    // "the claim code expired".
    const { claimSecret } = await createClaim(DEVICE, 'm', 'f')
    for (let i = 0; i < 60; i++) {
      const res = await token(tokenReq(claimSecret))
      expect(res.status).toBe(202)   // pending: nobody has typed the code
    }
  })

  it(`refuses past ${TOKEN_PER_DEVICE} polls per hour`, async () => {
    const { claimSecret } = await createClaim(DEVICE, 'm', 'f')
    for (let i = 0; i < TOKEN_PER_DEVICE; i++) {
      expect((await token(tokenReq(claimSecret))).status).toBe(202)
    }
    expect((await token(tokenReq(claimSecret))).status).toBe(429)
  })

  it('allows several full claim rounds before refusing', async () => {
    // A user who fumbles onboarding retries; four rounds must not be throttled.
    expect(TOKEN_PER_DEVICE).toBeGreaterThanOrEqual(60 * 4)
  })

  it('a malformed deviceId stays indistinguishable from pending and spends nothing', async () => {
    for (let i = 0; i < TOKEN_PER_DEVICE + 5; i++) {
      const res = await token(tokenReq('whatever', 'nope'))
      expect(res.status).toBe(202)
    }
    const { claimSecret } = await createClaim(DEVICE, 'm', 'f')
    expect((await token(tokenReq(claimSecret))).status).toBe(202)
  })
})
