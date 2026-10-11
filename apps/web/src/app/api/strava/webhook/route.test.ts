// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from '@/tests/helpers'

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
    stravaAccessRevoked: vi.fn(),
  },
  importStravaActivity: vi.fn(),
}))
vi.mock('@paddlesnitch/core/strava-storage', () => storage)
vi.mock('@paddlesnitch/analysis/strava-import', () => ({ importStravaActivity }))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { listKeys } from '@/lib/storage'
import { runJob } from '@/lib/jobs'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/strava/webhook', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
// The POST only writes a job (lib/jobs.ts, #413); this runs what it wrote.
const runAfters = async () => { for (const k of await listKeys('jobs/')) await runJob(k) }

let dataDir: string
afterEach(async () => { await cleanDataDir(dataDir) })
beforeEach(async () => {
  dataDir = await makeDataDir()
  vi.clearAllMocks()
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
    storage.stravaAccessRevoked.mockResolvedValue(true)
    await post({ object_type: 'athlete', aspect_type: 'update', owner_id: 99, updates: { authorized: 'false' } })
    await runAfters()
    expect(storage.deleteStravaTokens).toHaveBeenCalledWith('user-1')
    expect(storage.deleteAthleteIndex).toHaveBeenCalledWith(99)
    expect(importStravaActivity).not.toHaveBeenCalled()
  })

  // Security audit 2026-09: this endpoint is public and athlete ids are
  // public, so a forged event could disconnect any user.
  it('ignores a deauthorization Strava does not confirm', async () => {
    storage.getUserIdByAthleteId.mockResolvedValue('user-1')
    for (const answer of [false, 'unknown'] as const) {
      storage.stravaAccessRevoked.mockResolvedValue(answer)
      await post({ object_type: 'athlete', aspect_type: 'update', owner_id: 99, updates: { authorized: 'false' } })
      await runAfters()
    }
    expect(storage.deleteStravaTokens).not.toHaveBeenCalled()
    expect(storage.deleteAthleteIndex).not.toHaveBeenCalled()
  })
})
