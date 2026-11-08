// @vitest-environment node
// A portage note waits on its check before anyone sees it (packages/waterways/
// src/portage-store.ts, portage-moderation.ts). Held and pending notes are in
// their author's copy, the export and erasure, and nowhere public.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { createCaller } from '@paddlesnitch/api'
import { GET as exportData } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { GET as mapData } from '@/app/plan/data/[version]/[name]/route'
import { GET as v1Plan } from '@/app/api/v1/plan/route'
import { handleMcp } from '@/lib/mcp'
import { deleteObject, getJson, listKeys, putJson } from '@/lib/storage'
import { surveyPortages } from '@paddlesnitch/waterways/portage-survey'
import {
  addPendingPortage, clearPortageCache, deletePortage, finishReview, flagPortage, getPendingPortage, getReview, getReviewedPortage, holdPortage,
  listMyPortages, listPendingPortages, listPublicPortages, publishPortage, recordReview, reviewPortage, setReviewRefOnHidden,
} from '@paddlesnitch/waterways/portage-store'
import { buildHeldNoteIssue } from '@paddlesnitch/waterways/portage-moderation'
import type { PortageContribution, PortageVerdict } from '@paddlesnitch/waterways/portage'

const NOTE = 'SECRETNOTE zzqx'
const MARSH: [number, number] = [51.528627, -0.885527]
const FIELDS = { featureId: 'ea-lock:marsh', at: MARSH, landings: [[51.5289, -0.8858], [51.5283, -0.8852]] as [[number, number], [number, number]], notes: NOTE }
const VERDICT: PortageVerdict = { category: 'rude' }
const DW_START = '51.355333,-1.994961', DW_FINISH = '51.500833,-0.121667'

const anon = createCaller({ user: null })
const add = (u: TestUser) => addPendingPortage({ id: u.id, name: u.displayName }, FIELDS)
const signInAs = (idToken: string) => vi.mocked(cookies).mockResolvedValue({
  get: (name: string) => (name === 'tt_id' ? { name, value: idToken } : undefined),
} as never)
const dump = async () => (await mapData(new Request('http://x/plan/data/none/openportage'), { params: Promise.resolve({ version: 'none', name: 'openportage' }) })).text()
const v1 = async () => (await v1Plan(new NextRequest(`http://x/api/v1/plan?from=${DW_START}&to=${DW_FINISH}`))).text()
const mcp = async () => JSON.stringify(await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'plan_route', arguments: { from: DW_START, to: DW_FINISH } } }, 'http://x'))
const route = async () => JSON.stringify(await anon.plan.route({ start: [51.355333, -1.994961], finish: [51.500833, -0.121667], shape: 'one_way' }))

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearPortageCache() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe.each([
  ['pending', async (id: string) => { void id }],
  ['held', async (id: string) => { await holdPortage(id, VERDICT) }],
])('a %s note', (_, setup) => {
  const inPlace = async () => { const c = await add(await makeUser('Ann')); await setup(c.id); clearPortageCache(); return c }

  it('is not in listPublicPortages', async () => {
    const c = await inPlace()
    expect((await listPublicPortages()).map(p => p.id)).not.toContain(c.id)
  })
  it('is not in the CC0 dump', async () => { await inPlace(); expect(await dump()).not.toContain(NOTE) })
  it('is not on a route', async () => { await inPlace(); expect(await route()).not.toContain(NOTE) })
  it('is not in /api/v1/plan', async () => {
    await inPlace()
    const body = await v1()
    expect(body).toContain('Marsh Lock')
    expect(body).not.toContain(NOTE)
  })
  it('is not in the MCP server\'s plan', async () => {
    await inPlace()
    const body = await mcp()
    expect(body).toContain('Marsh Lock')
    expect(body).not.toContain(NOTE)
  })
  it('has no public copy in storage', async () => {
    await inPlace()
    expect(await listKeys('portages/public/')).toEqual([])
  })
  it('is in its author\'s own list', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await setup(c.id)
    expect((await listMyPortages(me.id)).map(p => p.id)).toEqual([c.id])
  })
  it('is in Download my data', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await setup(c.id)
    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData(new Request('http://x'))).text())
    expect(body.account.portages.map((p: PortageContribution) => p.id)).toEqual([c.id])
  })
  it('is erased with the account, its waiting copy included', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await setup(c.id)
    signInAs(me.idToken)
    expect((await deleteAccount(new Request('http://x'))).status).toBe(200)
    expect(await listKeys('portages/pending/')).toEqual([])
    expect(await listKeys(`users/${me.id}/portages/`)).toEqual([])
  })
  it('goes when its author deletes it', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await setup(c.id)
    expect(await deletePortage(me.id, c.id)).toBe(true)
    expect(await listPendingPortages()).toEqual([])
  })
})

describe('the check\'s outcomes', () => {
  it('a clean note becomes public, with no trace of the wait', async () => {
    const c = await add(await makeUser('Ann'))
    expect(await publishPortage(c.id)).toBe(true)
    clearPortageCache()
    const [p] = (await listPublicPortages()).filter(x => x.id === c.id)
    expect(p.notes).toBe(NOTE)
    expect(p).not.toHaveProperty('status')
    expect(await listKeys('portages/pending/')).toEqual([])
  })
  it('publishing twice is safe (a job can run twice)', async () => {
    const c = await add(await makeUser('Ann'))
    await publishPortage(c.id)
    expect(await publishPortage(c.id)).toBe(false)
  })
  it('holding keeps the verdict for the record, on both copies', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    const held = await holdPortage(c.id, VERDICT)
    expect(held).toMatchObject({ status: 'held', verdict: VERDICT })
    expect((await listMyPortages(me.id))[0]).toMatchObject({ status: 'held' })
    expect(await getPendingPortage(c.id)).toMatchObject({ status: 'held' })
  })
  it('a note its author deleted while waiting isn\'t held, so no issue is filed', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await deletePortage(me.id, c.id)
    expect(await holdPortage(c.id, VERDICT)).toBeNull()
  })
  it('a status on a public copy is dropped: nothing waiting may be public', async () => {
    const c = await add(await makeUser('Ann'))
    await putJson(`portages/public/${c.id}.json`, c)
    clearPortageCache()
    expect((await listPublicPortages()).map(p => p.id)).not.toContain(c.id)
  })
  it('lists what\'s waiting, oldest first', async () => {
    const newer = await add(await makeUser('Ann'))
    const older = await add(await makeUser('Bo'))
    await putJson(`portages/pending/${older.id}.json`, { ...older, createdAt: '2020-01-01T00:00:00.000Z' })
    expect((await listPendingPortages()).map(p => p.id)).toEqual([older.id, newer.id])
  })
  it('a stale job run can\'t publish a held note', async () => {
    const c = await add(await makeUser('Ann'))
    await holdPortage(c.id, VERDICT)
    expect(await publishPortage(c.id)).toBe(false)
    expect(await listKeys('portages/public/')).toEqual([])
  })
  it('a stale job run can\'t bring back a note deleted while it ran', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await deleteObject(`users/${me.id}/portages/${c.id}.json`)
    expect(await publishPortage(c.id)).toBe(false)
    expect(await listKeys('portages/public/')).toEqual([])
    expect(await listKeys(`users/${me.id}/portages/`)).toEqual([])
  })
})

async function heldWithIssue(u: TestUser, issue = 7) {
  const c = await add(u)
  const held = (await holdPortage(c.id, VERDICT))!
  await recordReview(held.reviewRef!, c.id, issue, 'rude')
  return held
}
async function flagThreeTimes(id: string) {
  for (const name of ['F1', 'F2', 'F3']) await flagPortage((await makeUser(name)).id, id)
}

describe('the review ref', () => {
  it('is random, safe on a command line, and not derived from the id', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    expect(held.reviewRef).toMatch(/^[0-9a-z]{20}$/)
    expect(held.reviewRef).not.toContain(held.id)
  })
  it('a repeated hold keeps it, so a repeated job finds the issue it filed', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    expect((await holdPortage(held.id, VERDICT))!.reviewRef).toBe(held.reviewRef)
  })
  it('never reaches the author\'s copy, the export or anything public', async () => {
    const me = await makeUser('Me')
    const held = await heldWithIssue(me)
    const ref = held.reviewRef!
    expect(JSON.stringify(await listMyPortages(me.id))).not.toContain(ref)
    signInAs(me.idToken)
    expect(await (await exportData(new Request('http://x'))).text()).not.toContain(ref)
    await reviewPortage(ref, 'publish')   // on the public copy until finishReview
    clearPortageCache()
    for (const surface of [await dump(), await route(), await v1(), await mcp(), JSON.stringify(await listPublicPortages())]) expect(surface).not.toContain(ref)
    expect(JSON.stringify(await listMyPortages(me.id))).not.toContain(ref)
  })
  it('on a note hidden by flags, stays off the public list and its author\'s copy', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await publishPortage(c.id)
    await flagThreeTimes(c.id)
    const { reviewRef } = (await setReviewRefOnHidden(c.id))!
    clearPortageCache()
    expect(JSON.stringify(await listPublicPortages())).not.toContain(reviewRef!)
    expect(JSON.stringify(await listMyPortages(me.id))).not.toContain(reviewRef!)
    expect((await setReviewRefOnHidden(c.id))!.reviewRef).toBe(reviewRef)
  })
  it('is only for a hidden note', async () => {
    const c = await add(await makeUser('Ann'))
    await publishPortage(c.id)
    expect(await setReviewRefOnHidden(c.id)).toBeNull()
  })
})

describe('the owner\'s decision', () => {
  it('publish lets a held note through', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    expect(await reviewPortage(held.reviewRef!, 'publish')).toEqual({ outcome: 'published', issue: 7 })
    clearPortageCache()
    expect((await listPublicPortages()).map(p => p.id)).toContain(held.id)
  })
  it('remove keeps it for its author, marked not published, and nowhere public', async () => {
    const me = await makeUser('Me')
    const held = await heldWithIssue(me)
    expect(await reviewPortage(held.reviewRef!, 'remove')).toEqual({ outcome: 'removed', issue: 7 })
    clearPortageCache()
    expect((await listMyPortages(me.id))[0]).toMatchObject({ status: 'not_published' })
    expect((await listMyPortages(me.id))[0]).not.toHaveProperty('verdict')
    expect(await listKeys('portages/pending/')).toEqual([])
    expect(await dump()).not.toContain(NOTE)
  })
  it('show reads the note a ref points at', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    expect((await getReviewedPortage(held.reviewRef!))?.notes).toBe(NOTE)
  })
  it('a failed close can be re-run: the decision stands and the mark waits', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    const ref = held.reviewRef!
    await reviewPortage(ref, 'publish')
    expect(await getReview(ref)).toMatchObject({ issue: 7, decided: 'published' })
    expect(await reviewPortage(ref, 'remove')).toEqual({ outcome: 'published', issue: 7 })
    await finishReview(ref)
    expect(await getReview(ref)).toBeNull()
    expect(await reviewPortage(ref, 'publish')).toBeNull()
    expect(await getJson(`portages/public/${held.id}.json`)).not.toHaveProperty('reviewRef')
  })
  it('a note withdrawn while held closes its issue, and says so', async () => {
    const me = await makeUser('Me')
    const held = await heldWithIssue(me)
    await deletePortage(me.id, held.id)
    expect(await getReviewedPortage(held.reviewRef!)).toBeNull()
    expect(await reviewPortage(held.reviewRef!, 'publish')).toEqual({ outcome: 'withdrawn', issue: 7 })
    expect(await listKeys('portages/public/')).toEqual([])
  })
  it('an unknown ref has nothing to decide', async () => {
    expect(await reviewPortage('nosuchref', 'remove')).toBeNull()
    expect(await reviewPortage('../../users/x', 'remove')).toBeNull()
  })
  it('held, published, three flags: a new ref for a new issue', async () => {
    const held = await heldWithIssue(await makeUser('Ann'))
    const first = held.reviewRef!
    await reviewPortage(first, 'publish')
    await finishReview(first)
    await flagThreeTimes(held.id)
    const again = (await setReviewRefOnHidden(held.id))!.reviewRef!
    expect(again).not.toBe(first)
  })
  it('flagged, restored, three flags: a new ref for a new issue', async () => {
    const c = await add(await makeUser('Ann'))
    await publishPortage(c.id)
    await flagThreeTimes(c.id)
    const first = (await setReviewRefOnHidden(c.id))!.reviewRef!
    await recordReview(first, c.id, 8, 'flagged')
    expect(await reviewPortage(first, 'publish')).toEqual({ outcome: 'published', issue: 8 })
    await finishReview(first)
    clearPortageCache()
    expect((await listPublicPortages()).find(p => p.id === c.id)).not.toHaveProperty('hidden', true)
    expect(await listKeys(`portages/flags/${c.id}/`)).toEqual([])
    await flagThreeTimes(c.id)
    expect((await setReviewRefOnHidden(c.id))!.reviewRef).not.toBe(first)
  })
  it('a note hidden by flags can be removed', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await publishPortage(c.id)
    await flagThreeTimes(c.id)
    const { reviewRef } = (await setReviewRefOnHidden(c.id))!
    await recordReview(reviewRef!, c.id, 9, 'flagged')
    expect(await reviewPortage(reviewRef!, 'remove')).toEqual({ outcome: 'removed', issue: 9 })
    expect(await listKeys('portages/public/')).toEqual([])
    expect((await listMyPortages(me.id))[0]).toMatchObject({ status: 'not_published' })
  })
  it('a surveyed portage hidden by flags can be removed: it stays hidden', async () => {
    const survey = surveyPortages[0]
    await flagThreeTimes(survey.id)
    const { reviewRef } = (await setReviewRefOnHidden(survey.id))!
    await recordReview(reviewRef!, survey.id, 10, 'flagged')
    expect(await reviewPortage(reviewRef!, 'remove')).toEqual({ outcome: 'removed', issue: 10 })
    await finishReview(reviewRef!)
    clearPortageCache()
    expect((await listPublicPortages()).find(p => p.id === survey.id)?.hidden).toBe(true)
    expect(await listKeys('users/')).toEqual(expect.not.arrayContaining([expect.stringContaining('portages')]))
  })
})

describe('the public issue for a held note', () => {
  const { title, body } = buildHeldNoteIssue('r3f', 'rude')

  it('has a plain title with nothing about the note', () => expect(title).toBe('A portage note needs review'))
  it('gives the reason and the commands, by ref', () => {
    expect(body).toContain('may be rude')
    for (const action of ['show', 'publish', 'remove']) expect(body).toContain(`waterways:review r3f ${action}`)
  })
  it('has no lock, date, place, id or bucket, whatever the record held', () => {
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}|\d+\.\d{3}|lock|s3:\/\/|data-prod/i)
  })
  it.each(['racist', 'sexist', 'offensive', 'rude', 'flagged', 'unchecked'] as const)('says why for %s', c => {
    expect(buildHeldNoteIssue('r', c).body).toContain('**Why:**')
  })
})
