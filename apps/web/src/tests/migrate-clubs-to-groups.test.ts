// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { getObject, putObject, getJson, listKeys } from '@/lib/storage'
import {
  migrateUserGroupIndex,
  migrateInvitationRecord,
  migrateVisibilityRecord,
  run,
} from '../../scripts/migrate-clubs-to-groups'

describe('migrate-clubs-to-groups pure transforms', () => {
  it('renames the reverse-index key clubIds → groupIds', () => {
    expect(migrateUserGroupIndex({ clubIds: ['a', 'b'] })).toEqual({ groupIds: ['a', 'b'] })
  })

  it('treats a missing record as no memberships', () => {
    expect(migrateUserGroupIndex(null)).toEqual({ groupIds: [] })
  })

  it('is a no-op on an already-migrated index (re-run safe)', () => {
    expect(migrateUserGroupIndex({ groupIds: ['x'] })).toEqual({ groupIds: ['x'] })
  })

  it('moves invitation clubId → groupId and drops the old key', () => {
    const out = migrateInvitationRecord({ id: 'i1', clubId: 'c1', role: 'member' })
    expect(out.groupId).toBe('c1')
    expect(out).not.toHaveProperty('clubId')
  })

  it('rewrites club visibility → group and visibleToClubId → visibleToGroupId', () => {
    const { record, changed } = migrateVisibilityRecord({
      id: 'x',
      visibility: 'club',
      visibleToClubId: 'c1',
    })
    expect(changed).toBe(true)
    expect(record.visibility).toBe('group')
    expect(record.visibleToGroupId).toBe('c1')
    expect(record).not.toHaveProperty('visibleToClubId')
  })

  it('leaves public/private metadata untouched (changed=false)', () => {
    expect(migrateVisibilityRecord({ visibility: 'public' }).changed).toBe(false)
    expect(migrateVisibilityRecord({ visibility: 'private' }).changed).toBe(false)
  })
})

describe('migrate-clubs-to-groups against storage', () => {
  let dataDir: string
  beforeEach(async () => { dataDir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dataDir) })

  it('moves every club artefact to its group location and rewrites visibility', async () => {
    // Old-world data, written under the pre-rename keys.
    await putObject('clubs/c1/metadata.json', JSON.stringify({
      id: 'c1', name: 'Squad', description: '', ownerId: 'u1',
      adminUserIds: [], memberUserIds: ['u2'], createdAt: '2026-01-01T00:00:00Z',
    }))
    await putObject('clubs/c1/invitations/i1.json', JSON.stringify({
      id: 'i1', clubId: 'c1', role: 'member', invitedBy: 'u1',
      toUserId: 'u3', status: 'pending',
    }))
    await putObject('pending-invitations/clubs/deadbeef/i2.json', JSON.stringify({
      id: 'i2', clubId: 'c1', role: 'member', invitedBy: 'u1',
      toEmail: 'new@example.com', status: 'pending',
    }))
    await putObject('users/u2/clubs.json', JSON.stringify({ clubIds: ['c1'] }))
    await putObject('courses/co1/metadata.json', JSON.stringify({
      id: 'co1', name: 'River', visibility: 'club', visibleToClubId: 'c1', adminUserId: 'u1',
    }))
    await putObject('trials/t1/metadata.json', JSON.stringify({
      id: 't1', name: 'Race', visibility: 'public', adminUserId: 'u1',
    }))

    await run()

    // Group metadata moved verbatim; old key gone.
    const meta = await getJson<{ name: string }>('groups/c1/metadata.json')
    expect(meta?.name).toBe('Squad')
    expect(await getObject('clubs/c1/metadata.json')).toBeNull()
    expect(await listKeys('clubs/')).toEqual([])

    // Resolved + pending invitations relocated with groupId.
    const inv = await getJson<Record<string, unknown>>('groups/c1/invitations/i1.json')
    expect(inv?.groupId).toBe('c1')
    expect(inv).not.toHaveProperty('clubId')
    const pending = await getJson<Record<string, unknown>>('pending-invitations/groups/deadbeef/i2.json')
    expect(pending?.groupId).toBe('c1')

    // Reverse index renamed.
    expect(await getJson('users/u2/groups.json')).toEqual({ groupIds: ['c1'] })
    expect(await getObject('users/u2/clubs.json')).toBeNull()

    // Visibility rewritten on the club-scoped course; public trial untouched.
    const course = await getJson<Record<string, unknown>>('courses/co1/metadata.json')
    expect(course?.visibility).toBe('group')
    expect(course?.visibleToGroupId).toBe('c1')
    expect(course).not.toHaveProperty('visibleToClubId')
  })

  it('is safe to run twice (second pass moves nothing)', async () => {
    await putObject('clubs/c9/metadata.json', JSON.stringify({
      id: 'c9', name: 'Once', description: '', ownerId: 'u1',
      adminUserIds: [], memberUserIds: [], createdAt: '2026-01-01T00:00:00Z',
    }))
    await run()
    await run() // should be a no-op, not an error
    expect(await getJson<{ name: string }>('groups/c9/metadata.json')).toMatchObject({ name: 'Once' })
    expect(await listKeys('clubs/')).toEqual([])
  })
})
