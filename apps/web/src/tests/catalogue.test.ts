// @vitest-environment node
// Trials and courses are listed by their folders, not by listing everything
// under trials/ (every entry, trace, failed upload and leaderboard), which
// grew with every race anyone uploaded. And listPrefixes behaves the same
// locally as on S3: names of the folders directly under a prefix.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'

const listed = vi.hoisted(() => ({ prefixes: [] as string[] }))
vi.mock('@paddlesnitch/core/storage', async (orig) => {
  const real = await orig<typeof import('@paddlesnitch/core/storage')>()
  return { ...real, listKeys: (p: string) => { listed.prefixes.push(p); return real.listKeys(p) } }
})

import { putJson, listPrefixes } from '@paddlesnitch/core/storage'
import { listTrials, listCourses, listUserEntryResultKeys, listUserFailedUploadKeys } from '@/lib/catalogue'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir(); listed.prefixes = []
  for (const t of ['t1', 't2']) {
    await putJson(`trials/${t}/metadata.json`, { id: t, courseId: 'c1' })
    await putJson(`trials/${t}/leaderboard.json`, [])
    for (const u of ['me', 'them']) await putJson(`trials/${t}/entries/${u}/e-${t}-${u}/result.json`, { entryId: `e-${t}-${u}` })
  }
  await putJson('trials/t1/failed-uploads/me/f1/diagnostic.json', {})
  // A trial folder without metadata (half-written): not a trial.
  await putJson('trials/t3/entries/me/e3/result.json', {})
  await putJson('courses/c1/metadata.json', { id: 'c1' })
})
afterEach(async () => { await cleanDataDir(dataDir) })

describe('listing trials and courses', () => {
  it('lists folder names under a prefix, and nothing for a missing one', async () => {
    expect(await listPrefixes('trials/')).toEqual(['t1', 't2', 't3'])
    expect(await listPrefixes('nothing/')).toEqual([])
  })

  it('reads each trial and course record, without listing any entries', async () => {
    expect((await listTrials()).map(t => t.id)).toEqual(['t1', 't2'])
    expect((await listCourses()).map(c => c.id)).toEqual(['c1'])
    expect(listed.prefixes).toEqual([])
  })

  it("finds one user's entries and failed uploads, in every trial, and nobody else's", async () => {
    expect((await listUserEntryResultKeys('me')).sort()).toEqual([
      'trials/t1/entries/me/e-t1-me/result.json', 'trials/t2/entries/me/e-t2-me/result.json', 'trials/t3/entries/me/e3/result.json',
    ])
    expect(await listUserFailedUploadKeys('me')).toEqual(['trials/t1/failed-uploads/me/f1/diagnostic.json'])
    expect(listed.prefixes.every(p => /^trials\/[^/]+\/(entries|failed-uploads)\/me\/$/.test(p))).toBe(true)
  })
})
