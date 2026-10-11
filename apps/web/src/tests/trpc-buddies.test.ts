// @vitest-environment node
// The buddies API (tRPC), against real cognito-local accounts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser, type TestUser } from './helpers'
import { createCaller } from '@paddlesnitch/api'
const REQUESTS_PER_HOUR = 30   // routers/buddies.ts (not a package export)

const as = (u: TestUser) => createCaller({ user: { id: u.id, email: u.email, displayName: u.displayName } })

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('the buddies API', () => {
  it('shows names, never emails, and where you stand with someone', async () => {
    const ann = await makeUser('Ann Paddler'), bob = await makeUser('Bob Rower')
    expect(await as(ann).buddies.status({ userId: bob.id })).toBe('none')
    expect(await as(ann).buddies.request({ userId: bob.id })).toBe('requested')
    expect(await as(ann).buddies.status({ userId: bob.id })).toBe('asked')
    expect(await as(bob).buddies.status({ userId: ann.id })).toBe('asked_you')
    expect(await as(bob).buddies.pendingCount()).toBe(1)

    const bobsView = await as(bob).buddies.list()
    expect(bobsView.incoming).toEqual([expect.objectContaining({ userId: ann.id, name: 'Ann Paddler' })])
    expect(JSON.stringify(bobsView)).not.toContain(ann.email)

    await as(bob).buddies.accept({ userId: ann.id })
    expect(await as(ann).buddies.status({ userId: bob.id })).toBe('buddies')
    expect((await as(ann).buddies.list()).buddies.map(b => b.name)).toEqual(['Bob Rower'])
    expect(await as(bob).buddies.pendingCount()).toBe(0)
    expect(await as(ann).buddies.status({ userId: ann.id })).toBe('self')
  })

  it("won't send a request to someone who doesn't exist", async () => {
    const ann = await makeUser('Ann')
    await expect(as(ann).buddies.request({ userId: 'nobody-by-this-id' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("accepting a request that wasn't sent fails", async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    await expect(as(ann).buddies.accept({ userId: bob.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it(`stops a flood of requests (${REQUESTS_PER_HOUR} an hour)`, async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob')
    for (let i = 0; i < REQUESTS_PER_HOUR; i++) await as(ann).buddies.request({ userId: bob.id })
    await expect(as(ann).buddies.request({ userId: bob.id })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })

  it('an invite link makes buddies and names who sent it; a retired one names nobody', async () => {
    const ann = await makeUser('Ann'), bob = await makeUser('Bob'), cat = await makeUser('Cat')
    const { token } = await as(ann).buddies.invite()
    expect(await as(bob).buddies.acceptInvite({ token })).toEqual({ outcome: 'accepted', name: 'Ann' })
    await as(ann).buddies.newInvite()
    expect(await as(cat).buddies.acceptInvite({ token })).toEqual({ outcome: 'invalid', name: null })
  })

  it('needs a sign-in', async () => {
    await expect(createCaller({ user: null }).buddies.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
