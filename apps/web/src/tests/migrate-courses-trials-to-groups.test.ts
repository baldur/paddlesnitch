// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { putObject, getJson, listKeys } from '@/lib/storage'
import { getUserGroupIds, getGroup } from '@/lib/groups'
import { personalGroupName, run } from '../../scripts/migrate-courses-trials-to-groups'
import type { CourseMetadata, TrialMetadata, GroupMetadata } from '@/lib/types'

const names: Record<string, string> = { u1: 'Baldur', u2: 'Connor' }
const stubLookup = async (sub: string) => names[sub]

describe('migrate-courses-trials-to-groups: personalGroupName', () => {
  it('uses the display name', () => {
    expect(personalGroupName('Baldur')).toBe("Baldur's group")
  })
  it('falls back when there is no name', () => {
    expect(personalGroupName(undefined)).toBe('Personal group')
    expect(personalGroupName('   ')).toBe('Personal group')
  })
})

describe('migrate-courses-trials-to-groups against storage', () => {
  let dataDir: string
  beforeEach(async () => { dataDir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dataDir) })

  async function seedLegacy() {
    await putObject('courses/co1/metadata.json', JSON.stringify({
      id: 'co1', name: 'River', sport: 'kayak', type: 'point_to_point',
      startLine: [[0, 0], [0, 1]], distanceMetres: 500,
      adminUserId: 'u1', visibility: 'public', createdAt: '2025-01-01T00:00:00Z',
    } satisfies CourseMetadata))
    await putObject('trials/t1/metadata.json', JSON.stringify({
      id: 't1', courseId: 'co1', name: 'Race', date: '2025-04-01', status: 'open',
      adminUserId: 'u1', visibility: 'public', participation: 'public',
      invitedUserIds: [], createdAt: '2025-03-01T00:00:00Z',
    } satisfies TrialMetadata))
    // A trial a different organiser ran on the public course → its own group.
    await putObject('trials/t2/metadata.json', JSON.stringify({
      id: 't2', courseId: 'co1', name: 'Connor TT', date: '2025-05-01', status: 'open',
      adminUserId: 'u2', visibility: 'public', participation: 'public',
      invitedUserIds: [], createdAt: '2025-04-01T00:00:00Z',
    } satisfies TrialMetadata))
  }

  it('mints one personal group per owner and stamps groupId', async () => {
    await seedLegacy()
    await run(stubLookup)

    const co1 = await getJson<CourseMetadata>('courses/co1/metadata.json')
    const t1 = await getJson<TrialMetadata>('trials/t1/metadata.json')
    const t2 = await getJson<TrialMetadata>('trials/t2/metadata.json')

    // u1 owns the course + t1 → same personal group; u2's t2 → a different one.
    expect(co1?.groupId).toBeTruthy()
    expect(t1?.groupId).toBe(co1?.groupId)
    expect(t2?.groupId).toBeTruthy()
    expect(t2?.groupId).not.toBe(co1?.groupId)

    // The groups exist, owned by the right user, with the display-name label.
    const g1 = await getGroup(co1!.groupId!)
    expect(g1).toMatchObject<Partial<GroupMetadata>>({ ownerId: 'u1', name: "Baldur's group" })
    const g2 = await getGroup(t2!.groupId!)
    expect(g2).toMatchObject<Partial<GroupMetadata>>({ ownerId: 'u2', name: "Connor's group" })

    // Reverse index updated so membership checks see the new groups.
    expect(await getUserGroupIds('u1')).toContain(co1!.groupId)
    expect(await getUserGroupIds('u2')).toContain(t2!.groupId)
  })

  it('is idempotent — a second run creates no further groups', async () => {
    await seedLegacy()
    await run(stubLookup)
    const groupsAfterFirst = (await listKeys('groups/')).filter(k => k.endsWith('/metadata.json')).length
    await run(stubLookup)
    const groupsAfterSecond = (await listKeys('groups/')).filter(k => k.endsWith('/metadata.json')).length
    expect(groupsAfterSecond).toBe(groupsAfterFirst)
  })
})
