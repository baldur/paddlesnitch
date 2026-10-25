// @vitest-environment node
// An entry's page finds it from a small index, not by listing every trial on
// the site (#409). Older entries are indexed the first time they're opened;
// erasure leaves no index behind.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@paddlesnitch/core/storage', async importOriginal => {
  const real = await importOriginal<typeof import('@paddlesnitch/core/storage')>()
  return { ...real, listKeys: vi.fn(real.listKeys) }
})

import { cookies } from 'next/headers'
import { listKeys, putJson, getJson } from '@/lib/storage'
import { resolveEntry, indexEntry } from '@/lib/entries'
import { DELETE as deleteAccount } from '@/app/api/account/route'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); vi.mocked(listKeys).mockClear() })
afterEach(async () => { await cleanDataDir(dataDir) })

async function plant(trialId: string, userId: string, entryId: string) {
  await putJson(`trials/${trialId}/entries/${userId}/${entryId}/result.json`, {
    entryId, userId, displayName: 'Paddler', submittedAt: '2025-01-01T00:00:00Z', filename: 'run.gpx', raceDate: '2025-01-01',
    boatClass: 'K1', crew: [], result: { startTimestamp: '', finishTimestamp: '', totalElapsedSeconds: 60, splits: [] },
  })
}
const scannedTrials = () => vi.mocked(listKeys).mock.calls.some(([p]) => p === 'trials/')

describe('finding an entry', () => {
  it('an indexed entry is found without listing every trial', async () => {
    await plant('t1', 'u1', 'e1'); await indexEntry('e1', 't1', 'u1')
    const r = await resolveEntry('e1')
    expect(r).toMatchObject({ trialId: 't1', key: 'trials/t1/entries/u1/e1/result.json' })
    expect(r?.entry.entryId).toBe('e1')
    expect(scannedTrials()).toBe(false)
  })

  it('an entry from before the index is still found, and indexed for next time', async () => {
    await plant('t1', 'u1', 'old')
    expect((await resolveEntry('old'))?.trialId).toBe('t1')
    expect(await getJson('entry-ids/old.json')).toEqual({ trialId: 't1', userId: 'u1' })
    vi.mocked(listKeys).mockClear()
    expect((await resolveEntry('old'))?.trialId).toBe('t1')
    expect(scannedTrials()).toBe(false)
  })

  it('an index whose entry is gone finds nothing, and odd ids are refused', async () => {
    await indexEntry('gone', 't1', 'u1')
    expect(await resolveEntry('gone')).toBeNull()
    expect(await resolveEntry('../x')).toBeNull()
    expect(await resolveEntry('nope')).toBeNull()
  })
})

describe('erasure', () => {
  it("removes the index of the user's entries, and leaves everyone else's", async () => {
    const me = await makeUser('Me'), other = await makeUser('Other')
    const course = await makeCourse(other.id)
    const trial = await makeTrial(course.id, other.id, 'open')
    await plant(trial.id, me.id, 'mine'); await indexEntry('mine', trial.id, me.id)
    await plant(trial.id, other.id, 'theirs'); await indexEntry('theirs', trial.id, other.id)
    vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === 'tt_id' ? { name: n, value: me.idToken } : undefined) } as never)
    expect((await deleteAccount(new Request('http://x'))).status).toBe(200)
    expect(await getJson('entry-ids/mine.json')).toBeNull()
    expect(await getJson('entry-ids/theirs.json')).toEqual({ trialId: trial.id, userId: other.id })
  })
})
