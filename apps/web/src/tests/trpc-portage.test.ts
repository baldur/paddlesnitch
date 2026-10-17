// @vitest-environment node
// OpenPortage contributions (tRPC `portage`, docs/features/river-planner.md
// "Contributions"): CC0, live at once, on everyone's routes, flag-and-hide,
// the author's to withdraw, in the account export, gone with the account.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { cookies } from 'next/headers'
import { createCaller } from '@paddlesnitch/api'
import { GET as exportData } from '@/app/api/account/export/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { GET as mapData } from '@/app/plan/data/[version]/[name]/route'
import { listKeys } from '@/lib/storage'
import { clearPortageCache } from '@paddlesnitch/waterways/portage-store'

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })
const anon = createCaller({ user: null })
const signInAs = (idToken: string) => vi.mocked(cookies).mockResolvedValue({
  get: (name: string) => (name === 'tt_id' ? { name, value: idToken } : undefined),
} as never)

// Marsh Lock on the Thames near Henley (in the Devizes–Westminster data), and
// two landings either side of it on the towpath bank.
const MARSH: [number, number] = [51.528627, -0.885527]
const PORTAGE = { featureId: 'ea-lock:marsh', at: MARSH, landings: [[51.5289, -0.8858], [51.5283, -0.8852]] as [[number, number], [number, number]], notes: 'Steps by the lock cottage', cc0: true as const }
const DW = { start: [51.355333, -1.994961] as [number, number], finish: [51.500833, -0.121667] as [number, number], shape: 'one_way' as const }
const marshStop = async () => {
  const r = await anon.plan.route(DW)
  if (!r.plan || typeof r.plan === 'string') throw new Error(String(r.plan))
  return r.plan.stops.find(s => s.feature.name === 'Marsh Lock')!
}
const mapGet = async (name: string) =>
  (await mapData(new Request(`http://x/plan/data/none/${name}`), { params: Promise.resolve({ version: 'none', name }) })).json()

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearPortageCache() })
afterEach(async () => { await cleanDataDir(dataDir); delete process.env.ADMIN_USER_IDS })

describe('adding portage details', () => {
  it('needs an account and an explicit CC0 release', async () => {
    await expect(anon.portage.add(PORTAGE)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    const ann = await makeUser('Ann')
    await expect(as(ann).portage.add({ ...PORTAGE, cc0: false as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('refuses landings far apart, on one spot, or far from the lock', async () => {
    const ann = await makeUser('Ann')
    await expect(as(ann).portage.add({ ...PORTAGE, landings: [MARSH, MARSH] })).rejects.toMatchObject({ message: 'landings_apart' })
    await expect(as(ann).portage.add({ ...PORTAGE, landings: [MARSH, [51.55, -0.885]] })).rejects.toMatchObject({ message: 'landings_apart' })
    await expect(as(ann).portage.add({ ...PORTAGE, landings: [[51.5345, -0.8855], [51.5349, -0.8855]] })).rejects.toMatchObject({ message: 'landings_far' })
  })

  it("is live at once on everyone's route, with the contributor's name and no user id", async () => {
    const ann = await makeUser('Ann Paddler')
    const saved = await as(ann).portage.add(PORTAGE)
    expect(saved).toMatchObject({ licence: 'CC0-1.0', name: 'Ann Paddler' })
    const stop = await marshStop()
    expect(stop.portages).toHaveLength(1)
    expect(stop.portages![0]).toMatchObject({ by: 'Ann Paddler', notes: 'Steps by the lock cottage' })
    expect(JSON.stringify(stop)).not.toContain(ann.id)
  })

  it('is published in the OpenPortage file, CC0, without user ids', async () => {
    const ann = await makeUser('Ann')
    await as(ann).portage.add(PORTAGE)
    const dump = await mapGet('openportage')
    expect(dump).toMatchObject({ licence: 'CC0-1.0', count: 1 })
    expect(JSON.stringify(dump)).not.toContain(ann.id)
  })

  it('counts towards coverage: the lock now has its portage side', async () => {
    const before = (await mapGet('coverage')).reduce((n: number, r: { locksWithSide: number }) => n + r.locksWithSide, 0)
    await as(await makeUser('Ann')).portage.add(PORTAGE)
    const after = (await mapGet('coverage')).reduce((n: number, r: { locksWithSide: number }) => n + r.locksWithSide, 0)
    expect(after).toBe(before + 1)
  })
})

describe('withdrawing, flagging and hiding', () => {
  it('only the author can delete one, and then it stops showing', async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    const { id } = await as(ann).portage.add(PORTAGE)
    await expect(as(bob).portage.delete({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await as(ann).portage.mine()).map(c => c.id)).toEqual([id])
    await as(ann).portage.delete({ id })
    expect((await marshStop()).portages).toBeUndefined()
  })

  it('three people flagging it hide it; flagging twice counts once', async () => {
    const ann = await makeUser('Ann')
    const { id } = await as(ann).portage.add(PORTAGE)
    const [b, c, d] = await Promise.all(['B', 'C', 'D'].map(n => makeUser(n)))
    expect((await as(b).portage.flag({ id })).result).toBe('flagged')
    expect((await as(b).portage.flag({ id })).result).toBe('flagged')
    expect((await as(c).portage.flag({ id })).result).toBe('flagged')
    expect((await marshStop()).portages).toHaveLength(1)
    expect((await as(d).portage.flag({ id })).result).toBe('hidden')
    expect((await marshStop()).portages).toBeUndefined()
  })

  it('only a platform admin can hide or restore one', async () => {
    const ann = await makeUser('Ann'), admin = await makeUser('Admin')
    const { id } = await as(ann).portage.add(PORTAGE)
    await expect(as(ann).portage.hide({ id, hidden: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    process.env.ADMIN_USER_IDS = admin.id
    await as(admin).portage.hide({ id, hidden: true })
    expect((await marshStop()).portages).toBeUndefined()
    await as(admin).portage.hide({ id, hidden: false })
    expect((await marshStop()).portages).toHaveLength(1)
  })
})

describe('portage details and your account', () => {
  it('are in Download my data', async () => {
    const me = await makeUser('Me')
    const saved = await as(me).portage.add(PORTAGE)
    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.account.portages).toEqual([saved])
  })

  it('are deleted with the account, public copies included', async () => {
    const me = await makeUser('Me')
    await as(me).portage.add(PORTAGE)
    signInAs(me.idToken)
    expect((await deleteAccount()).status).toBe(200)
    expect(await listKeys('portages/public/')).toEqual([])
    expect(await listKeys(`users/${me.id}/portages/`)).toEqual([])
    expect((await marshStop()).portages).toBeUndefined()
  })
})
