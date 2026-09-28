// @vitest-environment node
// GDPR: account erasure (Art. 17) and export (Art. 15/20) must cover EVERY
// kind of personal data, not only the time-trial data they started with.
// Paddles, share links, the coach profile, trackers and their recordings,
// Strava links and group memberships were all missed before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
// The Strava deauthorize call must never leave the test process.
vi.mock('@paddlesnitch/core/strava', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@paddlesnitch/core/strava')>()),
  revoke: vi.fn(),
}))

import { cookies } from 'next/headers'
import { GET as exportData } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { listKeys, getJson, putJson } from '@/lib/storage'
import {
  saveSession, shareSession, getSharedSession, saveAthleteProfile, type AnalysisSession,
} from '@paddlesnitch/analysis/analysis-store'
import {
  createClaim, linkClaim, redeemToken, storeDeviceSession, storeDeviceMotion, listUserDevices,
} from '@paddlesnitch/core/devices'
import { putStravaTokens, putAthleteIndex, getUserIdByAthleteId } from '@/lib/strava-storage'
import { putGroup, getGroup, addUserToGroupIndex, putJoinRequest, putInvitation } from '@/lib/groups'
import type { GroupMetadata } from '@/lib/types'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
})
afterEach(async () => {
  await cleanDataDir(dataDir)
})

function signInAs(idToken: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' ? { name, value: idToken } : undefined),
  } as never)
}

function paddle(userId: string, id: string): AnalysisSession {
  return {
    id, userId, createdAt: '2026-09-01T10:00:00Z', paddledAt: '2026-09-01T09:00:00Z',
    source: { type: 'file', filename: 'x.gpx' }, doubleStrokeRate: false,
    note: 'private diary note', insight: 'summary', result: { points: [] },
  } as unknown as AnalysisSession
}

async function pairTracker(userId: string, deviceId: string) {
  const claim = await createClaim(deviceId, 'T-Beam', '0.14.0')
  const linked = await linkClaim(claim.claimCode, userId, 'Boat tracker')
  if ('error' in linked) throw new Error(`link failed: ${linked.error}`)
  const bound = await redeemToken(deviceId, claim.claimSecret)
  if (bound.status !== 'bound') throw new Error(`redeem failed: ${bound.status}`)
  // Sanity: the tracker really is paired, so the erasure tests can't pass vacuously.
  if ((await listUserDevices(userId)).length === 0) throw new Error('tracker not paired')
}

function group(id: string, ownerId: string, adminUserIds: string[], memberUserIds: string[]): GroupMetadata {
  return { id, name: id, description: '', ownerId, adminUserIds, memberUserIds, createdAt: '2026-01-01T00:00:00Z' }
}

async function keysMentioning(needle: string): Promise<string[]> {
  const out: string[] = []
  for (const k of await listKeys('')) {
    if (k.includes(needle)) { out.push(k); continue }
    const v = await getJson<unknown>(k).catch(() => null)
    if (v && JSON.stringify(v).includes(needle)) out.push(k)
  }
  return out
}

describe('DELETE /api/account removes every kind of personal data', () => {
  it('deletes paddles, the coach profile, and share links (a shared link stops working)', async () => {
    const me = await makeUser('Me')
    await saveSession(paddle(me.id, 'p1'))
    await saveSession(paddle(me.id, 'p2'))
    await saveAthleteProfile(me.id, { text: 'likes sprints', updatedAt: '2026-09-01T00:00:00Z' } as never)
    const shared = await shareSession(me.id, 'p1')

    signInAs(me.idToken)
    expect((await deleteAccount()).status).toBe(200)

    expect(await listKeys(`analysis/${me.id}/`)).toEqual([])
    expect(await getSharedSession(shared!.shareId)).toBeNull()
    expect(await listKeys('analysis/shared/')).toEqual([])
  })

  it('unlinks their trackers and deletes the recordings and motion data they uploaded', async () => {
    const me = await makeUser('Me')
    await pairTracker(me.id, 'AABBCCDD')
    await storeDeviceSession(
      { deviceId: 'AABBCCDD', userId: me.id, filename: 'track_001.csv', points: 3 },
      'timestamp,lat,lon\n',
    )
    await storeDeviceMotion('AABBCCDD', me.id, 'track_001.csv', 'ms,ax\n1,0\n', 1)

    signInAs(me.idToken)
    await deleteAccount()

    expect(await listUserDevices(me.id)).toEqual([])
    expect(await listKeys('devices/AABBCCDD/')).toEqual([])
    expect(await listKeys('device-tokens/')).toEqual([])
    expect(await listKeys('device-claims/')).toEqual([])
    expect(await listKeys('device-claim-codes/')).toEqual([])
  })

  it("keeps another user's recordings on a tracker that changed hands", async () => {
    const previous = await makeUser('Previous owner')
    const me = await makeUser('Me')
    await storeDeviceSession(
      { deviceId: 'AABBCCDD', userId: previous.id, filename: 'old.csv', points: 3 },
      'timestamp,lat,lon\n',
    )
    await pairTracker(me.id, 'AABBCCDD')
    await storeDeviceSession(
      { deviceId: 'AABBCCDD', userId: me.id, filename: 'mine.csv', points: 3 },
      'timestamp,lat,lon\n',
    )

    signInAs(me.idToken)
    await deleteAccount()

    const left = await listKeys('devices/AABBCCDD/')
    expect(left.some(k => k.includes('/uploads/old.csv'))).toBe(true)
    expect(left.some(k => k.includes('/uploads/mine.csv'))).toBe(false)
    expect(await keysMentioning(me.id)).toEqual([])
  })

  it('removes the Strava athlete link so a later Strava sign-in cannot land on the deleted account', async () => {
    const me = await makeUser('Me')
    await putStravaTokens(me.id, { accessToken: 'a', refreshToken: 'r', expiresAt: 0, athleteId: 777 } as never)
    await putAthleteIndex(777, me.id)

    signInAs(me.idToken)
    await deleteAccount()

    expect(await getUserIdByAthleteId(777)).toBeNull()
  })

  it('deletes the private contact records behind their issue reports, and only theirs', async () => {
    const me = await makeUser('Me')
    const other = await makeUser('Other')
    await putJson('feedback-contacts/1.json', { issueNumber: 1, userId: me.id, email: me.email })
    await putJson('feedback-contacts/2.json', { issueNumber: 2, userId: other.id, email: other.email })

    signInAs(me.idToken)
    await deleteAccount()

    expect(await listKeys('feedback-contacts/')).toEqual(['feedback-contacts/2.json'])
  })

  it('takes them out of groups they belong to, with their invitations and join requests', async () => {
    const owner = await makeUser('Owner')
    const me = await makeUser('Me')
    await putGroup(group('g1', owner.id, [me.id], []))
    await putGroup(group('g2', owner.id, [], [me.id]))
    await putGroup(group('g3', owner.id, [], []))
    for (const g of ['g1', 'g2']) await addUserToGroupIndex(me.id, g)
    await putJoinRequest({ id: 'jr', groupId: 'g3', userId: me.id, requestedAt: '2026-01-01T00:00:00Z', status: 'pending' })
    await putInvitation({
      id: 'inv', groupId: 'g3', role: 'member', invitedBy: owner.id, toUserId: me.id,
      createdAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', status: 'pending',
    })

    signInAs(me.idToken)
    await deleteAccount()

    expect((await getGroup('g1'))!.adminUserIds).toEqual([])
    expect((await getGroup('g2'))!.memberUserIds).toEqual([])
    expect(await listKeys('groups/g3/join-requests/')).toEqual([])
    expect(await listKeys('groups/g3/invitations/')).toEqual([])
    expect(await keysMentioning(me.id)).toEqual([])
  })

  it('hands a group they own to an admin, else to a member, and deletes it only if nobody is left', async () => {
    const me = await makeUser('Me')
    const admin = await makeUser('Admin')
    const member = await makeUser('Member')
    await putGroup(group('with-admin', me.id, [admin.id], [member.id]))
    await putGroup(group('members-only', me.id, [], [member.id]))
    await putGroup(group('just-me', me.id, [], []))
    for (const g of ['with-admin', 'members-only', 'just-me']) await addUserToGroupIndex(me.id, g)

    signInAs(me.idToken)
    await deleteAccount()

    const a = await getGroup('with-admin')
    expect(a!.ownerId).toBe(admin.id)
    expect(a!.adminUserIds).toEqual([])
    expect(a!.memberUserIds).toEqual([member.id])
    const b = await getGroup('members-only')
    expect(b!.ownerId).toBe(member.id)
    expect(b!.memberUserIds).toEqual([])
    expect(await getGroup('just-me')).toBeNull()
  })
})

describe('GET /api/account/export includes every kind of personal data', () => {
  it('exports paddles, coach profile, account records, groups and trackers', async () => {
    const me = await makeUser('Me')
    const owner = await makeUser('Owner')
    await saveSession(paddle(me.id, 'p1'))
    await saveAthleteProfile(me.id, { text: 'likes sprints', updatedAt: '2026-09-01T00:00:00Z' } as never)
    await putJson(`users/${me.id}/profile.json`, { public: true, handle: 'me' })
    await putJson(`users/${me.id}/contact.json`, { email: 'real@example.com' })
    await putStravaTokens(me.id, { accessToken: 'SECRET-A', refreshToken: 'SECRET-R', expiresAt: 0, athleteId: 777 } as never)
    await putGroup(group('g1', owner.id, [], [me.id]))
    await addUserToGroupIndex(me.id, 'g1')
    await pairTracker(me.id, 'AABBCCDD')
    await storeDeviceSession(
      { deviceId: 'AABBCCDD', userId: me.id, filename: 'track_001.csv', points: 3 },
      'timestamp,lat,lon\n',
    )
    await putJson('feedback-contacts/5.json', { issueNumber: 5, userId: me.id, email: me.email })
    await putJson('feedback-contacts/6.json', { issueNumber: 6, userId: owner.id, email: owner.email })

    signInAs(me.idToken)
    const text = await (await exportData()).text()
    const body = JSON.parse(text)

    expect(body.paddles.map((p: { id: string }) => p.id)).toEqual(['p1'])
    expect(body.paddles[0].note).toBe('private diary note')
    expect(body.coachProfile.text).toBe('likes sprints')
    expect(body.account.profile).toEqual({ public: true, handle: 'me' })
    expect(body.account.contact).toEqual({ email: 'real@example.com' })
    expect(body.account.strava).toEqual({ connected: true, athleteId: 777 })
    expect(body.groups).toEqual([{ id: 'g1', name: 'g1', role: 'member' }])
    expect(body.trackers).toHaveLength(1)
    expect(body.trackers[0].deviceId).toBe('AABBCCDD')
    expect(body.trackerRecordings).toHaveLength(1)
    expect(body.issueReports).toEqual([{ issueNumber: 5, userId: me.id, email: me.email }])
    // Credentials are never exported.
    expect(text).not.toContain('SECRET-A')
    expect(text).not.toContain('SECRET-R')
    expect(text).not.toContain('tokenHash')
  })

  it("does not include another user's paddles or trackers", async () => {
    const me = await makeUser('Me')
    const stranger = await makeUser('Stranger')
    await saveSession(paddle(stranger.id, 'theirs'))
    await pairTracker(stranger.id, '11223344')

    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.paddles).toEqual([])
    expect(body.trackers).toEqual([])
  })
})
