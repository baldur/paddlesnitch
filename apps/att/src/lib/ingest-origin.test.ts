import { describe, it, expect } from 'vitest'
import { isAllowedIngestOrigin } from './ingest-origin'

const withHeaders = (h: Record<string, string>) =>
  new Request('https://paddlesnitch.com/att/api/track', { method: 'POST', headers: h })

describe('isAllowedIngestOrigin', () => {
  it('allows our own origins', () => {
    expect(isAllowedIngestOrigin(withHeaders({ origin: 'https://paddlesnitch.com' }))).toBe(true)
    expect(isAllowedIngestOrigin(withHeaders({ origin: 'https://www.paddlesnitch.com' }))).toBe(true)
    expect(isAllowedIngestOrigin(withHeaders({ origin: 'http://localhost:3000' }))).toBe(true)
  })

  it('rejects a foreign origin', () => {
    expect(isAllowedIngestOrigin(withHeaders({ origin: 'https://evil.example.com' }))).toBe(false)
  })

  it('rejects when no Origin and no Referer (a bare script ping)', () => {
    expect(isAllowedIngestOrigin(withHeaders({}))).toBe(false)
  })

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(isAllowedIngestOrigin(withHeaders({ referer: 'https://paddlesnitch.com/att/trials/x' }))).toBe(true)
    expect(isAllowedIngestOrigin(withHeaders({ referer: 'https://evil.example.com/x' }))).toBe(false)
    expect(isAllowedIngestOrigin(withHeaders({ referer: 'not a url' }))).toBe(false)
  })

  it('prefers Origin over Referer', () => {
    // A foreign Origin is rejected even with a valid-looking Referer.
    expect(isAllowedIngestOrigin(withHeaders({
      origin: 'https://evil.example.com',
      referer: 'https://paddlesnitch.com/att',
    }))).toBe(false)
  })
})
