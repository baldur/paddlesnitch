// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { putObject, getJson } from '@/lib/storage'
import { migrateParticipationRecord, run } from '../../scripts/migrate-participation-open-to-public'

describe('migrate-participation pure transform', () => {
  it("rewrites 'open' → 'public'", () => {
    const { record, changed } = migrateParticipationRecord({ id: 't', participation: 'open' })
    expect(changed).toBe(true)
    expect(record.participation).toBe('public')
  })
  it('leaves members/invitational/public untouched', () => {
    for (const p of ['members', 'invitational', 'public']) {
      expect(migrateParticipationRecord({ participation: p }).changed).toBe(false)
    }
  })
})

describe('migrate-participation against storage', () => {
  let dataDir: string
  beforeEach(async () => { dataDir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dataDir) })

  it("flips stored 'open' trials to 'public' and leaves others alone", async () => {
    await putObject('trials/t1/metadata.json', JSON.stringify({
      id: 't1', courseId: 'c1', name: 'Old', date: '2025-01-01', status: 'open',
      adminUserId: 'u1', visibility: 'public', participation: 'open',
      invitedUserIds: [], createdAt: '2025-01-01T00:00:00Z',
    }))
    await putObject('trials/t2/metadata.json', JSON.stringify({
      id: 't2', courseId: 'c1', name: 'New', date: '2025-02-01', status: 'open',
      adminUserId: 'u1', visibility: 'public', participation: 'members',
      invitedUserIds: [], createdAt: '2025-02-01T00:00:00Z',
    }))
    // An entry result.json under a trial must not be touched by the migration.
    await putObject('trials/t1/entries/u1/e1/result.json', JSON.stringify({ entryId: 'e1' }))

    await run()

    expect((await getJson<{ participation: string }>('trials/t1/metadata.json'))?.participation).toBe('public')
    expect((await getJson<{ participation: string }>('trials/t2/metadata.json'))?.participation).toBe('members')
    // Untouched entry file still parses (would throw if rewritten as a trial).
    expect(await getJson<{ entryId: string }>('trials/t1/entries/u1/e1/result.json')).toEqual({ entryId: 'e1' })
  })
})
