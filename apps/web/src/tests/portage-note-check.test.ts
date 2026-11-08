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
import { getJson, listKeys } from '@/lib/storage'
import {
  addPendingPortage, clearPortageCache, deletePortage, getPendingPortage, holdPortage, listMyPortages, listPendingPortages,
  listPublicPortages, publishPortage, reviewPortage,
} from '@paddlesnitch/waterways/portage-store'
import { buildHeldNoteIssue, safeForIssue } from '@paddlesnitch/waterways/portage-moderation'
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
    const { putJson } = await import('@/lib/storage')
    await putJson(`portages/public/${c.id}.json`, c)
    clearPortageCache()
    expect((await listPublicPortages()).map(p => p.id)).not.toContain(c.id)
  })
  it('lists what\'s waiting, oldest first', async () => {
    const a = await add(await makeUser('Ann'))
    const b = await add(await makeUser('Bo'))
    expect((await listPendingPortages()).map(p => p.id).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('the owner\'s decision', () => {
  it('publish lets a held note through', async () => {
    const c = await add(await makeUser('Ann'))
    await holdPortage(c.id, VERDICT)
    expect(await reviewPortage(c.id, 'publish')).toBe('published')
    clearPortageCache()
    expect((await listPublicPortages()).map(p => p.id)).toContain(c.id)
  })
  it('remove keeps it for its author, marked not published, and nowhere public', async () => {
    const me = await makeUser('Me')
    const c = await add(me)
    await holdPortage(c.id, VERDICT)
    expect(await reviewPortage(c.id, 'remove')).toBe('removed')
    clearPortageCache()
    expect((await listMyPortages(me.id))[0]).toMatchObject({ status: 'not_published' })
    expect((await listMyPortages(me.id))[0]).not.toHaveProperty('verdict')
    expect(await listKeys('portages/pending/')).toEqual([])
    expect(await dump()).not.toContain(NOTE)
  })
  it('a note hidden by flags can be restored or removed', async () => {
    const c = await add(await makeUser('Ann'))
    await publishPortage(c.id)
    const pub = await getJson<PortageContribution>(`portages/public/${c.id}.json`)
    const { putJson } = await import('@/lib/storage')
    await putJson(`portages/public/${c.id}.json`, { ...pub, hidden: true })
    expect(await reviewPortage(c.id, 'remove')).toBe('removed')
    expect(await listKeys('portages/public/')).toEqual([])
  })
  it('there is nothing to decide on a public note nobody hid, or one already decided', async () => {
    const c = await add(await makeUser('Ann'))
    await publishPortage(c.id)
    expect(await reviewPortage(c.id, 'remove')).toBeNull()
    expect(await reviewPortage(c.id, 'publish')).toBeNull()
    expect(await reviewPortage('no-such-note', 'remove')).toBeNull()
  })
})

describe('the public issue for a held note', () => {
  const full = {
    id: 'abc123', userId: 'user-sub-999', name: 'Real Name', notes: 'the slur itself', at: MARSH, landings: FIELDS.landings, featureId: 'ea-lock:marsh',
    licence: 'CC0-1.0', createdAt: '2026-11-08T09:16:20.000Z', updatedAt: '2026-11-08T09:16:20.000Z', status: 'held',
  } as PortageContribution

  it('can\'t reach the note, the name or the user id, even handed the whole record', () => {
    const { title, body } = buildHeldNoteIssue(full, { category: 'racist' }, 'Marsh Lock')
    for (const secret of ['the slur itself', 'Real Name', 'user-sub-999']) expect(title + body).not.toContain(secret)
  })
  it('says where, the day and why, and how to read and decide', () => {
    const { title, body } = buildHeldNoteIssue(full, { category: 'rude' }, 'Marsh Lock')
    expect(title).toBe('Portage note held for review at Marsh Lock')
    expect(body).toContain('2026-11-08')
    expect(body).not.toContain('09:16')
    expect(body).toContain('may be rude')
    expect(body).toContain('s3://paddlesnitch-data-prod/portages/pending/abc123.json')
    expect(body).toContain('waterways:review abc123 remove')
  })
  it('points at the public copy for a note hidden by flags', () => {
    expect(buildHeldNoteIssue(full, { category: 'flagged' }).body).toContain('portages/public/abc123.json')
  })
  it('category only unless the bleeped text passed the check itself', () => {
    expect(buildHeldNoteIssue(full, { category: 'rude', bleeped: 'b***dy lock' }).body).toContain('not shown here')
    expect(buildHeldNoteIssue(full, { category: 'rude', bleeped: 'b***dy lock', bleepedPassed: false }).body).not.toContain('b***dy')
    expect(buildHeldNoteIssue(full, { category: 'rude', bleeped: 'b***dy lock', bleepedPassed: true }).body).toContain('b***dy lock')
  })
  it('falls back to category only when nothing is left after cleaning', () => {
    expect(buildHeldNoteIssue(full, { category: 'rude', bleeped: 'https://x.example @them', bleepedPassed: true }).body).toContain('not shown here')
  })
  it.each([
    ['a link', 'see https://evil.example/a now', 'evil.example'],
    ['www', 'www.evil.example now', 'evil.example'],
    ['a bare domain', 'visit evil.example/page', 'evil.example'],
    ['a mention', 'hey @baldur look', '@baldur'],
    ['an email', 'mail me@evil.example', 'evil.example'],
    ['an issue reference', 'see #913 and org/repo#4', '#'],
    ['html', '<img src=x onerror=y> hi', '<'],
    ['a markdown link', '[click](x)', '['],
  ])('strips %s', (_, text, gone) => expect(safeForIssue(text)).not.toContain(gone))
  it('keeps ordinary words', () => expect(safeForIssue('steep  steps, take care')).toBe('steep steps, take care'))
})
