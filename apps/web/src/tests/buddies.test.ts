// @vitest-environment node
// Buddies (docs/features/buddies-and-compare.md): mutual, and a buddy sees your
// paddles unless you switch sharing off or hide one. Every way two people can
// relate, and what each may then see. Titles read as the rules.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import {
  requestBuddy, acceptRequest, declineRequest, cancelRequest, removeBuddy, areBuddies, listBuddies,
  listIncomingRequests, listOutgoingRequests, getInviteToken, rotateInvite, inviteOwner, acceptInvite,
  setBuddySharing, canViewPaddle, eraseBuddies, exportBuddies,
} from '@paddlesnitch/core/buddies'
import { listKeys } from '@paddlesnitch/core/storage'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

const PADDLE = {}                       // a paddle with nothing hidden
const ids = async (p: Promise<{ userId: string }[]>) => (await p).map(x => x.userId)

describe('becoming buddies', () => {
  it('a request waits for the other to accept; then each is the other\'s buddy', async () => {
    expect(await requestBuddy('ann', 'bob')).toBe('requested')
    expect(await ids(listIncomingRequests('bob'))).toEqual(['ann'])
    expect(await ids(listOutgoingRequests('ann'))).toEqual(['bob'])
    expect(await areBuddies('ann', 'bob')).toBe(false)

    expect(await acceptRequest('bob', 'ann')).toBe(true)
    expect(await areBuddies('ann', 'bob')).toBe(true)
    expect(await areBuddies('bob', 'ann')).toBe(true)
    expect(await ids(listBuddies('ann'))).toEqual(['bob'])
    expect(await ids(listIncomingRequests('bob'))).toEqual([])
    expect(await ids(listOutgoingRequests('ann'))).toEqual([])
  })

  it('only the person asked can accept: the asker accepting their own request does nothing', async () => {
    await requestBuddy('ann', 'bob')
    expect(await acceptRequest('ann', 'bob')).toBe(false)
    expect(await areBuddies('ann', 'bob')).toBe(false)
  })

  it('two people asking each other are buddies', async () => {
    await requestBuddy('ann', 'bob')
    expect(await requestBuddy('bob', 'ann')).toBe('accepted')
    expect(await areBuddies('ann', 'bob')).toBe(true)
    expect(await ids(listIncomingRequests('ann'))).toEqual([])
    expect(await ids(listOutgoingRequests('ann'))).toEqual([])
  })

  it('a declined request disappears for both, and makes no buddies', async () => {
    await requestBuddy('ann', 'bob')
    await declineRequest('bob', 'ann')
    expect(await areBuddies('ann', 'bob')).toBe(false)
    expect(await ids(listIncomingRequests('bob'))).toEqual([])
    expect(await ids(listOutgoingRequests('ann'))).toEqual([])
  })

  it('a request can be taken back before it is answered', async () => {
    await requestBuddy('ann', 'bob')
    await cancelRequest('ann', 'bob')
    expect(await ids(listIncomingRequests('bob'))).toEqual([])
    expect(await acceptRequest('bob', 'ann')).toBe(false)
  })

  it("you can't be your own buddy, or ask someone who already is", async () => {
    expect(await requestBuddy('ann', 'ann')).toBe('self')
    await requestBuddy('ann', 'bob'); await acceptRequest('bob', 'ann')
    expect(await requestBuddy('ann', 'bob')).toBe('already_buddies')
  })

  it('ids that could reach other storage paths are refused', async () => {
    expect(await requestBuddy('ann', '../users/bob')).toBe('bad_request')
    expect(await requestBuddy('ann/x', 'bob')).toBe('bad_request')
    expect(await areBuddies('ann', '../bob')).toBe(false)
  })

  it('either side can end it, for both', async () => {
    await requestBuddy('ann', 'bob'); await acceptRequest('bob', 'ann')
    await removeBuddy('bob', 'ann')
    expect(await areBuddies('ann', 'bob')).toBe(false)
    expect(await ids(listBuddies('ann'))).toEqual([])
  })
})

describe('invite links', () => {
  it('opening someone\'s link makes you buddies at once', async () => {
    const token = await getInviteToken('ann')
    expect(await getInviteToken('ann')).toBe(token)              // the same link until rotated
    expect(await inviteOwner(token)).toBe('ann')
    expect(await acceptInvite('bob', token)).toBe('accepted')
    expect(await areBuddies('ann', 'bob')).toBe(true)
    expect(await acceptInvite('bob', token)).toBe('already_buddies')
  })

  it('a new link retires the old one', async () => {
    const old = await getInviteToken('ann')
    const fresh = await rotateInvite('ann')
    expect(fresh).not.toBe(old)
    expect(await acceptInvite('bob', old)).toBe('invalid')
    expect(await acceptInvite('bob', fresh)).toBe('accepted')
  })

  it('your own link, or a made-up one, makes no buddies', async () => {
    const token = await getInviteToken('ann')
    expect(await acceptInvite('ann', token)).toBe('self')
    expect(await acceptInvite('bob', 'x'.repeat(22))).toBe('invalid')
    expect(await acceptInvite('bob', '../../users/ann/buddy-invite')).toBe('invalid')
  })
})

describe('who may see a paddle (canViewPaddle)', () => {
  it('its owner, always, even a paddle hidden from buddies', async () => {
    expect(await canViewPaddle('ann', 'ann', PADDLE)).toBe(true)
    expect(await canViewPaddle('ann', 'ann', { hiddenFromBuddies: true })).toBe(true)
  })

  it('nobody else: not a stranger, not someone signed out', async () => {
    expect(await canViewPaddle('eve', 'ann', PADDLE)).toBe(false)
    expect(await canViewPaddle(null, 'ann', PADDLE)).toBe(false)
  })

  it('not someone who has only asked, or been asked', async () => {
    await requestBuddy('bob', 'ann')
    expect(await canViewPaddle('bob', 'ann', PADDLE)).toBe(false)
    expect(await canViewPaddle('ann', 'bob', PADDLE)).toBe(false)
  })

  it('a buddy sees your paddles: by default, both ways', async () => {
    await requestBuddy('bob', 'ann'); await acceptRequest('ann', 'bob')
    expect(await canViewPaddle('bob', 'ann', PADDLE)).toBe(true)
    expect(await canViewPaddle('ann', 'bob', PADDLE)).toBe(true)
  })

  it('not a paddle you hid from buddies', async () => {
    await requestBuddy('bob', 'ann'); await acceptRequest('ann', 'bob')
    expect(await canViewPaddle('bob', 'ann', { hiddenFromBuddies: true })).toBe(false)
  })

  it("not when you've switched sharing off (and again when you switch it back on)", async () => {
    await requestBuddy('bob', 'ann'); await acceptRequest('ann', 'bob')
    await setBuddySharing('ann', false)
    expect(await canViewPaddle('bob', 'ann', PADDLE)).toBe(false)
    expect(await canViewPaddle('ann', 'bob', PADDLE)).toBe(true)   // Bob still shares his
    await setBuddySharing('ann', true)
    expect(await canViewPaddle('bob', 'ann', PADDLE)).toBe(true)
  })

  it('no longer, once either of you removes the other', async () => {
    await requestBuddy('bob', 'ann'); await acceptRequest('ann', 'bob')
    await removeBuddy('ann', 'bob')
    expect(await canViewPaddle('bob', 'ann', PADDLE)).toBe(false)
  })

  it("a buddy's buddy is not your buddy", async () => {
    await requestBuddy('bob', 'ann'); await acceptRequest('ann', 'bob')
    await requestBuddy('cat', 'bob'); await acceptRequest('bob', 'cat')
    expect(await canViewPaddle('cat', 'ann', PADDLE)).toBe(false)
  })
})

describe('your data', () => {
  it('Download my data lists your buddies, requests both ways and sharing', async () => {
    await requestBuddy('ann', 'bob'); await acceptRequest('bob', 'ann')
    await requestBuddy('cat', 'ann'); await requestBuddy('ann', 'dan')
    await setBuddySharing('ann', false)
    const e = await exportBuddies('ann')
    expect(e.buddies.map(b => b.userId)).toEqual(['bob'])
    expect(e.requestsIn.map(r => r.userId)).toEqual(['cat'])
    expect(e.requestsOut.map(r => r.userId)).toEqual(['dan'])
    expect(e.sharing).toEqual({ paddles: false })
  })

  it("deleting an account removes it from every buddy and request, and its link, and nobody else's", async () => {
    await requestBuddy('ann', 'bob'); await acceptRequest('bob', 'ann')
    await requestBuddy('cat', 'ann'); await requestBuddy('ann', 'dan')
    await requestBuddy('bob', 'cat'); await acceptRequest('cat', 'bob')   // unrelated to ann
    const token = await getInviteToken('ann')
    await eraseBuddies('ann')
    expect(await ids(listBuddies('bob'))).toEqual(['cat'])
    expect(await ids(listIncomingRequests('dan'))).toEqual([])
    expect(await ids(listOutgoingRequests('cat'))).toEqual([])
    expect(await inviteOwner(token)).toBeNull()
    const left = [...await listKeys('buddies/'), ...await listKeys('buddy-requests/'), ...await listKeys('buddy-requests-out/'), ...await listKeys('buddy-invites/')]
    expect(left.filter(k => k.includes('ann'))).toEqual([])
    expect(await areBuddies('bob', 'cat')).toBe(true)
  })
})
