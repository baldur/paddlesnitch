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
import { listKeys } from '@/lib/storage'

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

describe('plans and your account', () => {
  it('are in Download my data', async () => {
    const me = await makeUser('Me')
    const saved = await as(me).plan.save(DW)
    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.account.plans).toEqual([saved])
  })

  it('are deleted with the account', async () => {
    const me = await makeUser('Me')
    await as(me).plan.save(DW)
    expect(await listKeys(`users/${me.id}/plans/`)).toHaveLength(1)
    signInAs(me.idToken)
    expect((await deleteAccount()).status).toBe(200)
    expect(await listKeys(`users/${me.id}/plans/`)).toEqual([])
  })
})
