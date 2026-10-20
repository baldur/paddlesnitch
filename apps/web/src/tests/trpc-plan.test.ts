// @vitest-environment node
// Saved river plans (tRPC `plan`): private to their owner, in the account
// export, gone with the account.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { createCaller } from '@paddlesnitch/api'
import { GET as exportData } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { listKeys, getJson } from '@/lib/storage'
import { GET as mapData } from '@/app/plan/data/[version]/[name]/route'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const anon = createCaller({ user: null })
const signInAs = (idToken: string) => vi.mocked(cookies).mockResolvedValue({
  get: (name: string) => (name === 'tt_id' ? { name, value: idToken } : undefined),
} as never)

const DW = {
  title: 'DW training', region: 'dw',
  start: [51.355333, -1.994961] as [number, number], finish: [51.500833, -0.121667] as [number, number],
  shape: 'one_way' as const, startAt: '2027-04-17T08:00:00.000Z', paceKmh: 8, portageMinutes: 3,
}

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('saved plans', () => {
  it('saves, lists, opens, updates and deletes your own plans', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    expect(saved).toMatchObject({ ...DW, id: expect.any(String) })

    expect((await as(ann).plan.list()).map(p => p.id)).toEqual([saved.id])
    expect(await as(ann).plan.get({ id: saved.id })).toEqual(saved)

    const updated = await as(ann).plan.save({ ...DW, id: saved.id, shape: 'return', title: '  Return  ' })
    expect(updated).toMatchObject({ id: saved.id, shape: 'return', title: 'Return', createdAt: saved.createdAt })
    expect(await as(ann).plan.list()).toHaveLength(1)

    await as(ann).plan.delete({ id: saved.id })
    expect(await as(ann).plan.list()).toEqual([])
  })

  it("nobody else can open, change or delete them, and they don't learn it exists", async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    const saved = await as(ann).plan.save(DW)
    await expect(as(bob).plan.get({ id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(as(bob).plan.save({ ...DW, id: saved.id, title: 'mine now' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(as(bob).plan.delete({ id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await as(bob).plan.list()).toEqual([])
    expect((await as(ann).plan.get({ id: saved.id })).title).toBe('DW training')
  })

  it('saving needs an account', async () => {
    await expect(anon.plan.save(DW)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(anon.plan.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('refuses a region we have no data for, and nonsense numbers', async () => {
    const ann = await makeUser('Ann')
    await expect(as(ann).plan.save({ ...DW, region: 'nowhere' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(as(ann).plan.save({ ...DW, paceKmh: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(as(ann).plan.save({ ...DW, start: [91, 0] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('an empty title becomes "Untitled plan"', async () => {
    const ann = await makeUser('Ann')
    expect((await as(ann).plan.save({ ...DW, title: '   ' })).title).toBe('Untitled plan')
  })
})

const befriend = async (a: TestUser, b: TestUser) => {
  await as(a).buddies.request({ userId: b.id })
  await as(b).buddies.accept({ userId: a.id })
}

describe('sharing a plan', () => {
  it('a shared plan opens from its link for anyone, signed in or not, with the owner named', async () => {
    const ann = await makeUser('Ann Paddler'), bob = await makeUser('Bob')
    const saved = await as(ann).plan.save(DW)
    const shared = await as(ann).plan.share({ id: saved.id })
    expect(shared.shareId).toEqual(expect.any(String))
    expect((await as(ann).plan.share({ id: saved.id })).shareId).toBe(shared.shareId)   // same link again

    const seen = await anon.plan.shared({ shareId: shared.shareId! })
    expect(seen).toMatchObject({ owner: 'Ann Paddler', mine: false, plan: { title: 'DW training', start: DW.start } })
    expect(JSON.stringify(seen)).not.toContain(ann.email)
    expect((await as(bob).plan.shared({ shareId: shared.shareId! })).mine).toBe(false)
    expect((await as(ann).plan.shared({ shareId: shared.shareId! })).mine).toBe(true)
  })

  it('an unshared plan has no link, and stopping sharing breaks the old one', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    await expect(anon.plan.shared({ shareId: 'made-up-link' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const { shareId } = await as(ann).plan.share({ id: saved.id })
    expect((await as(ann).plan.unshare({ id: saved.id })).shareId).toBeUndefined()
    await expect(anon.plan.shared({ shareId: shareId! })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // Sharing again makes a new link; the old one stays dead.
    const again = await as(ann).plan.share({ id: saved.id })
    expect(again.shareId).not.toBe(shareId)
    await expect(anon.plan.shared({ shareId: shareId! })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('editing a shared plan keeps it shared, and the link shows the change', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    const { shareId } = await as(ann).plan.share({ id: saved.id })
    await as(ann).plan.save({ ...DW, id: saved.id, shape: 'return' })
    expect((await anon.plan.shared({ shareId: shareId! })).plan.shape).toBe('return')
  })

  it('deleting a shared plan breaks its link', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    const { shareId } = await as(ann).plan.share({ id: saved.id })
    await as(ann).plan.delete({ id: saved.id })
    await expect(anon.plan.shared({ shareId: shareId! })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await getJson(`plans/shared/${shareId}.json`)).toBeNull()
  })

  it('only the owner can share it', async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    const saved = await as(ann).plan.save(DW)
    await expect(as(bob).plan.share({ id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(as(bob).plan.unshare({ id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('your own notes on a plan', () => {
  it('saves a note on the plan and on stops; an empty one removes it', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    await as(ann).plan.setNotes({ id: saved.id, notes: '  Kit: spare paddle  ' })
    const withStop = await as(ann).plan.setNotes({ id: saved.id, stop: { featureId: 'ea-lock:marsh', text: 'Crew meets here with food' } })
    expect(withStop).toMatchObject({ notes: 'Kit: spare paddle', stopNotes: { 'ea-lock:marsh': 'Crew meets here with food' } })
    const cleared = await as(ann).plan.setNotes({ id: saved.id, stop: { featureId: 'ea-lock:marsh', text: ' ' } })
    expect(cleared.stopNotes).toBeUndefined()
    expect(cleared.notes).toBe('Kit: spare paddle')
  })

  it('survive saving the plan again', async () => {
    const ann = await makeUser('Ann')
    const saved = await as(ann).plan.save(DW)
    await as(ann).plan.setNotes({ id: saved.id, notes: 'Kit list', stop: { featureId: 'x', text: 'Food' } })
    const again = await as(ann).plan.save({ ...DW, id: saved.id, paceKmh: 9 })
    expect(again).toMatchObject({ paceKmh: 9, notes: 'Kit list', stopNotes: { x: 'Food' } })
  })

  it("only the owner can write them, and a shared plan's link shows them", async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    const saved = await as(ann).plan.save(DW)
    await expect(as(bob).plan.setNotes({ id: saved.id, notes: 'mine now' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await as(ann).plan.setNotes({ id: saved.id, notes: 'Meet at Marsh Lock' })
    const { shareId } = await as(ann).plan.share({ id: saved.id })
    expect((await anon.plan.shared({ shareId: shareId! })).plan.notes).toBe('Meet at Marsh Lock')
  })
})

describe("buddies' plans", () => {
  it("lists your buddies' shared plans, never their private ones, and nobody else's", async () => {
    const ann = await makeUser('Ann Paddler'), bob = await makeUser('Bob'), cat = await makeUser('Cat')
    await befriend(ann, bob)
    const open = await as(ann).plan.save({ ...DW, title: 'Shared one' })
    await as(ann).plan.save({ ...DW, title: 'Private one' })
    const { shareId } = await as(ann).plan.share({ id: open.id })
    const catsShared = await as(cat).plan.save({ ...DW, title: "Cat's" })
    await as(cat).plan.share({ id: catsShared.id })   // Cat isn't Bob's buddy

    expect(await as(bob).plan.buddies()).toEqual([
      { shareId, title: 'Shared one', shape: 'one_way', updatedAt: expect.any(String), owner: 'Ann Paddler' },
    ])
    expect(await as(cat).plan.buddies()).toEqual([])

    await as(ann).plan.unshare({ id: open.id })
    expect(await as(bob).plan.buddies()).toEqual([])
  })

  it('needs an account', async () => {
    await expect(anon.plan.buddies()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('plans and your account', () => {
  it('are in Download my data', async () => {
    const me = await makeUser('Me')
    const saved = await as(me).plan.save(DW)
    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.account.plans).toEqual([saved])
  })

  it('are deleted with the account, and their links stop working', async () => {
    const me = await makeUser('Me')
    const saved = await as(me).plan.save(DW)
    const { shareId } = await as(me).plan.share({ id: saved.id })
    expect(await listKeys(`users/${me.id}/plans/`)).toHaveLength(1)
    signInAs(me.idToken)
    expect((await deleteAccount()).status).toBe(200)
    expect(await listKeys(`users/${me.id}/plans/`)).toEqual([])
    expect(await getJson(`plans/shared/${shareId}.json`)).toBeNull()
    await expect(anon.plan.shared({ shareId: shareId! })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('routing on the server (plan.route)', () => {
  // With no published national version in test storage, the committed
  // Devizes–Westminster data stands in (docs/features/waterways-uk-ireland.md).
  it('routes between two clicks for anyone, with every stop and no times', async () => {
    const r = await anon.plan.route({ start: DW.start, finish: DW.finish, shape: 'one_way' })
    if (!r.plan || typeof r.plan === 'string') throw new Error(String(r.plan))
    expect(r.start?.waterway).toBe('Kennet and Avon Canal')
    expect(r.plan.lengthM / 1000).toBeCloseTo(201.3, 0)
    expect(r.plan.stops.filter(s => s.feature.kind === 'lock')).toHaveLength(77)
    expect(r.plan.stops[0]).not.toHaveProperty('eta')
  })

  it('snaps the start alone, and says when a click is off the water', async () => {
    expect((await anon.plan.route({ start: DW.start, finish: null, shape: 'one_way' }))).toMatchObject({ start: { waterway: 'Kennet and Avon Canal' }, plan: null })
    expect((await anon.plan.route({ start: [51.32, -1.2], finish: null, shape: 'one_way' })).start).toBeNull()
    expect((await anon.plan.route({ start: DW.start, finish: [51.32, -1.2], shape: 'one_way' }))).toMatchObject({ finish: null, plan: 'finish_off_water' })
  })

  it("names the finish's waterway even when there's no route to it", async () => {
    const r = await anon.plan.route({ start: DW.start, finish: DW.start, shape: 'one_way' })
    expect(r).toMatchObject({ finish: { waterway: 'Kennet and Avon Canal' }, plan: 'too_short' })
  })

  it('lists the waterways a click could have meant (#505)', async () => {
    expect((await anon.plan.choices({ at: DW.start, radiusM: 60 })).map(c => c.waterway)).toEqual(['Kennet and Avon Canal'])
    expect(await anon.plan.choices({ at: [51.32, -1.2], radiusM: 60 })).toEqual([])
    await expect(anon.plan.choices({ at: DW.start, radiusM: 5000 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('saves plans made on the national network', async () => {
    const ann = await makeUser('Ann')
    expect((await as(ann).plan.save({ ...DW, region: 'gbie' })).region).toBe('gbie')
  })
})

describe("the map's network and places", () => {
  const get = async (name: string, version = 'none') =>
    mapData(new Request(`http://x/plan/data/${version}/${name}`), { params: Promise.resolve({ version, name }) })

  it('serves the overview, an area in detail, and the places index', async () => {
    const overview = await (await get('overview')).json()
    expect(overview.length).toBeGreaterThan(10)
    const reading = await (await get('area-102_-2')).json()   // 51.0–51.5 N, 1.0–0.5 W: Reading
    expect(reading.length).toBeGreaterThan(10)
    expect(await (await get('area-0_0')).json()).toEqual([])   // the Gulf of Guinea
    const places = await (await get('places')).json()
    expect(places.some((p: { name: string }) => /Marsh Lock/.test(p.name))).toBe(true)
  })

  it('caches the live version for good and anything else briefly', async () => {
    expect((await get('overview', 'dw-fixture')).headers.get('Cache-Control')).toContain('immutable')
    expect((await get('overview', 'old-version')).headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('serves coverage by waterway, and the scored water by level for the map', async () => {
    const rows = await (await get('coverage')).json()
    expect(rows.find((r: { name: string }) => r.name === 'Kennet and Avon Canal')).toMatchObject({ kind: 'canal', locksWithSide: 0 })
    const lines = await (await get('coverage-lines')).json()
    expect(Object.keys(lines).sort()).toEqual(['good', 'some', 'thin'])
    expect(lines.some.length).toBeGreaterThan(10)
  })

  it('404s anything else', async () => {
    expect((await get('secrets')).status).toBe(404)
  })
})
