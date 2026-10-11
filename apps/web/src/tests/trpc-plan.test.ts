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
