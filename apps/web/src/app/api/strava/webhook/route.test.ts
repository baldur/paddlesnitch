// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Verify token comes from core/strava; stub it + the storage lookups + the
// importer so we test the webhook's ROUTING, not Strava/network. The shared
// mocks are created via vi.hoisted so the (hoisted) vi.mock factories can use them.
vi.mock('@paddlesnitch/core/strava', () => ({
  getWebhookVerifyToken: () => Promise.resolve('verify-me'),
}))
const { storage, importStravaActivity } = vi.hoisted(() => ({
  storage: {
    getUserIdByAthleteId: vi.fn(),
    getStravaAutoImport: vi.fn(),
    deleteStravaTokens: vi.fn(),
    deleteAthleteIndex: vi.fn(),
  },
  importStravaActivity: vi.fn(),
}))
vi.mock('@paddlesnitch/core/strava-storage', () => storage)
vi.mock('@paddlesnitch/analysis/strava-import', () => ({ importStravaActivity }))

// Capture after() callbacks so the test can run + await the async processing.
const afterFns: Array<() => unknown> = []
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { afterFns.push(fn) } }
})

import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/strava/webhook', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
const runAfters = () => Promise.all(afterFns.splice(0).map(f => f()))

beforeEach(() => {
  vi.clearAllMocks(); afterFns.length = 0
  storage.getUserIdByAthleteId.mockResolvedValue(null)
  storage.getStravaAutoImport.mockResolvedValue(true)
})

describe('GET validation handshake', () => {
  it('echoes hub.challenge when the verify token matches', async () => {
    const res = await GET(new NextRequest('http://localhost/api/strava/webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=verify-me'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ 'hub.challenge': 'abc123' })
  })
  it('rejects a wrong verify token with 403', async () => {
    const res = await GET(new NextRequest('http://localhost/api/strava/webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=WRONG'))
    expect(res.status).toBe(403)
  })
})

describe('POST events', () => {
  it('always acks 200 immediately', async () => {
    const res = await post({ object_type: 'activity', aspect_type: 'create', object_id: 1, owner_id: 99 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('auto-imports a new activity for a connected, opted-in user', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue('user-1')
    await post({ object_type: 'activity', aspect_type: 'create', object_id: 555, owner_id: 99 })
    await runAfters()
    expect(importStravaActivity).toHaveBeenCalledWith('user-1', 555)
  })

  it('does NOT import for an athlete we do not know', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue(null)
    await post({ object_type: 'activity', aspect_type: 'create', object_id: 555, owner_id: 42 })
    await runAfters()
    expect(importStravaActivity).not.toHaveBeenCalled()
  })

  it('does NOT import when the user has opted out', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue('user-1')
    storage.getStravaAutoImport.mockResolvedValue(false)
    await post({ object_type: 'activity', aspect_type: 'create', object_id: 555, owner_id: 99 })
    await runAfters()
    expect(importStravaActivity).not.toHaveBeenCalled()
  })

  it('ignores activity updates/deletes', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue('user-1')
    await post({ object_type: 'activity', aspect_type: 'delete', object_id: 555, owner_id: 99 })
    await runAfters()
    expect(importStravaActivity).not.toHaveBeenCalled()
  })

  it('disconnects on athlete deauthorization', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue('user-1')
    await post({ object_type: 'athlete', aspect_type: 'update', owner_id: 99, updates: { authorized: 'false' } })
    await runAfters()
    expect(storage.deleteStravaTokens).toHaveBeenCalledWith('user-1')
    expect(storage.deleteAthleteIndex).toHaveBeenCalledWith(99)
    expect(importStravaActivity).not.toHaveBeenCalled()
  })
})
