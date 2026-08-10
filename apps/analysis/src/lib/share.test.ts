import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import {
  saveSession, getSession, deleteSession,
  shareSession, unshareSession, getSharedSession,
  type AnalysisSession,
} from './analysis-store'

// Sharing writes a real share index + session to storage, so drive it against a
// temp .local-data dir like the trials tests (#202).
let dir: string
const USER = 'user-abc'
const OTHER = 'user-xyz'

function makeSession(userId: string, id: string): AnalysisSession {
  return {
    id, userId,
    createdAt: '2026-08-10T10:00:00.000Z',
    paddledAt: '2026-08-10T09:00:00.000Z',
    source: { type: 'file', filename: 'paddle.gpx' },
    doubleStrokeRate: false,
    note: '',
    insight: 'A steady outing.',
    // Only the fields the store touches matter here.
    result: { durationS: 1800, distanceKm: 6, avgSR: 60, cruiseSpeed: 3, surges: [], avgDps: 2, points: [], strokeRateDoubled: false } as AnalysisSession['result'],
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-share-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('shareSession / getSharedSession', () => {
  it('mints a token and resolves the paddle by token alone', async () => {
    await saveSession(makeSession(USER, 's1'))
    const shared = await shareSession(USER, 's1')
    expect(shared?.shareId).toBeTruthy()

    const resolved = await getSharedSession(shared!.shareId)
    expect(resolved?.id).toBe('s1')
    expect(resolved?.userId).toBe(USER)
  })

  it('persists the token on the session so the owner can see it is shared', async () => {
    await saveSession(makeSession(USER, 's1'))
    const { shareId } = (await shareSession(USER, 's1'))!
    const s = await getSession(USER, 's1')
    expect(s?.shareId).toBe(shareId)
  })

  it('is idempotent — sharing twice keeps the same token', async () => {
    await saveSession(makeSession(USER, 's1'))
    const first = (await shareSession(USER, 's1'))!.shareId
    const second = (await shareSession(USER, 's1'))!.shareId
    expect(second).toBe(first)
  })

  it('returns null for a session that does not exist', async () => {
    expect(await shareSession(USER, 'nope')).toBeNull()
  })

  it('returns null for an unknown token', async () => {
    expect(await getSharedSession('unknown-token')).toBeNull()
  })
})

describe('unshareSession', () => {
  it('revokes the link so the token stops resolving', async () => {
    await saveSession(makeSession(USER, 's1'))
    const { shareId } = (await shareSession(USER, 's1'))!
    await unshareSession(USER, 's1')

    expect(await getSharedSession(shareId)).toBeNull()
    const s = await getSession(USER, 's1')
    expect(s?.shareId).toBeUndefined()
  })

  it('is a no-op on a paddle that was never shared', async () => {
    await saveSession(makeSession(USER, 's1'))
    const s = await unshareSession(USER, 's1')
    expect(s?.shareId).toBeUndefined()
  })
})

describe('share index integrity', () => {
  it('does not resolve a token after the paddle is deleted', async () => {
    await saveSession(makeSession(USER, 's1'))
    const { shareId } = (await shareSession(USER, 's1'))!
    await deleteSession(USER, 's1')
    expect(await getSharedSession(shareId)).toBeNull()
  })

  it('sharing one user\'s paddle never exposes another user\'s', async () => {
    await saveSession(makeSession(USER, 's1'))
    await saveSession(makeSession(OTHER, 's1'))
    const { shareId } = (await shareSession(USER, 's1'))!
    const resolved = await getSharedSession(shareId)
    expect(resolved?.userId).toBe(USER)
  })
})
