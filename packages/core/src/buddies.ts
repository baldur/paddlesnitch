// Buddies: two paddlers who see each other's paddles
// (docs/features/buddies-and-compare.md). Mutual: one asks, the other accepts
// (or one hands out an invite link and the other opens it); either can remove
// the other at any time. A buddy sees your paddles unless you switch sharing
// off or hide one. canViewPaddle is the one rule for that.
//
// Storage, one object per item:
//   buddies/{userId}/{buddyId}.json            { since }   both sides
//   buddy-requests/{toUserId}/{fromUserId}.json { at }      waiting for "to"
//   buddy-requests-out/{fromUserId}/{toUserId}.json { at }  the same, listed by sender
//   buddy-invites/{token}.json                 { userId }  an invite link
//   users/{userId}/buddy-invite.json           { token }
//   users/{userId}/buddy-sharing.json          { paddles }  default true
import { randomBytes } from 'crypto'
import { getJson, putJson, deleteObject, deleteObjects, listKeys } from './storage'

export type Buddy = { userId: string; since: string }
export type BuddyRequest = { userId: string; at: string }

const ID = /^[A-Za-z0-9_-]{1,64}$/
const ok = (id: string) => ID.test(id)
const buddyKey = (a: string, b: string) => `buddies/${a}/${b}.json`
const reqKey = (to: string, from: string) => `buddy-requests/${to}/${from}.json`
const outKey = (from: string, to: string) => `buddy-requests-out/${from}/${to}.json`
const inviteKey = (token: string) => `buddy-invites/${token}.json`
const myInviteKey = (userId: string) => `users/${userId}/buddy-invite.json`
const sharingKey = (userId: string) => `users/${userId}/buddy-sharing.json`
const now = () => new Date().toISOString()
const lastSeg = (k: string) => k.slice(k.lastIndexOf('/') + 1).replace(/\.json$/, '')

export async function areBuddies(a: string, b: string): Promise<boolean> {
  if (!ok(a) || !ok(b) || a === b) return false
  return (await getJson(buddyKey(a, b))) !== null
}

export async function listBuddies(userId: string): Promise<Buddy[]> {
  if (!ok(userId)) return []
  const keys = await listKeys(`buddies/${userId}/`)
  const out = await Promise.all(keys.map(async k => {
    const rec = await getJson<{ since: string }>(k)
    return rec ? { userId: lastSeg(k), since: rec.since } : null
  }))
  return out.filter((b): b is Buddy => !!b).sort((x, y) => (x.since < y.since ? 1 : -1))
}

async function listReq(prefix: string): Promise<BuddyRequest[]> {
  const keys = await listKeys(prefix)
  const out = await Promise.all(keys.map(async k => {
    const rec = await getJson<{ at: string }>(k)
    return rec ? { userId: lastSeg(k), at: rec.at } : null
  }))
  return out.filter((r): r is BuddyRequest => !!r).sort((x, y) => (x.at < y.at ? 1 : -1))
}
/** Requests waiting for `userId` to answer. */
export const listIncomingRequests = (userId: string) => (ok(userId) ? listReq(`buddy-requests/${userId}/`) : Promise.resolve([]))
/** Requests `userId` has sent that haven't been answered. */
export const listOutgoingRequests = (userId: string) => (ok(userId) ? listReq(`buddy-requests-out/${userId}/`) : Promise.resolve([]))

async function becomeBuddies(a: string, b: string): Promise<void> {
  const since = now()
  await Promise.all([
    putJson(buddyKey(a, b), { since }), putJson(buddyKey(b, a), { since }),
    deleteObject(reqKey(a, b)), deleteObject(outKey(b, a)),
    deleteObject(reqKey(b, a)), deleteObject(outKey(a, b)),
  ])
}

export type RequestOutcome = 'requested' | 'accepted' | 'already_buddies' | 'self' | 'bad_request'

/**
 * `from` asks `to` to be buddies. Asking someone who has already asked you
 * accepts theirs: two people asking each other are buddies.
 */
export async function requestBuddy(from: string, to: string): Promise<RequestOutcome> {
  if (!ok(from) || !ok(to)) return 'bad_request'
  if (from === to) return 'self'
  if (await areBuddies(from, to)) return 'already_buddies'
  if (await getJson(reqKey(from, to))) { await becomeBuddies(from, to); return 'accepted' }
  const at = now()
  await Promise.all([putJson(reqKey(to, from), { at }), putJson(outKey(from, to), { at })])
  return 'requested'
}

/** `userId` accepts the request `from` sent. False if there isn't one. */
export async function acceptRequest(userId: string, from: string): Promise<boolean> {
  if (!ok(userId) || !ok(from) || !(await getJson(reqKey(userId, from)))) return false
  await becomeBuddies(userId, from)
  return true
}

/** `userId` declines the request `from` sent. The sender isn't told. */
export async function declineRequest(userId: string, from: string): Promise<void> {
  if (!ok(userId) || !ok(from)) return
  await Promise.all([deleteObject(reqKey(userId, from)), deleteObject(outKey(from, userId))])
}

/** `from` takes back a request to `to` that hasn't been answered. */
export async function cancelRequest(from: string, to: string): Promise<void> {
  if (!ok(from) || !ok(to)) return
  await Promise.all([deleteObject(reqKey(to, from)), deleteObject(outKey(from, to))])
}

/** Either side ends it, for both. */
export async function removeBuddy(userId: string, buddyId: string): Promise<void> {
  if (!ok(userId) || !ok(buddyId)) return
  await Promise.all([deleteObject(buddyKey(userId, buddyId)), deleteObject(buddyKey(buddyId, userId))])
}

// ---- Invite links: hand one out, whoever opens it (signed in) becomes your buddy.

/** This user's invite token, made the first time it's asked for. */
export async function getInviteToken(userId: string): Promise<string> {
  const mine = await getJson<{ token: string }>(myInviteKey(userId))
  if (mine?.token) return mine.token
  return rotateInvite(userId)
}

/** A new token; the old link stops working. */
export async function rotateInvite(userId: string): Promise<string> {
  const old = await getJson<{ token: string }>(myInviteKey(userId))
  if (old?.token) await deleteObject(inviteKey(old.token))
  const token = randomBytes(16).toString('base64url')
  await Promise.all([putJson(inviteKey(token), { userId }), putJson(myInviteKey(userId), { token })])
  return token
}

/** Whose invite this is, or null for an unknown or retired one. */
export async function inviteOwner(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const rec = await getJson<{ userId: string }>(inviteKey(token))
  if (!rec) return null
  // Only the token the owner currently holds counts.
  const mine = await getJson<{ token: string }>(myInviteKey(rec.userId))
  return mine?.token === token ? rec.userId : null
}

/** `userId` opens an invite link: they become buddies with its owner. */
export async function acceptInvite(userId: string, token: string): Promise<'accepted' | 'already_buddies' | 'self' | 'invalid'> {
  const owner = await inviteOwner(token)
  if (!owner || !ok(userId)) return 'invalid'
  if (owner === userId) return 'self'
  if (await areBuddies(userId, owner)) return 'already_buddies'
  await becomeBuddies(userId, owner)
  return 'accepted'
}

// ---- What buddies may see.

export async function getBuddySharing(userId: string): Promise<{ paddles: boolean }> {
  const rec = await getJson<{ paddles?: boolean }>(sharingKey(userId))
  return { paddles: rec?.paddles !== false }
}
export async function setBuddySharing(userId: string, paddles: boolean): Promise<void> {
  await putJson(sharingKey(userId), { paddles })
}

/**
 * May `viewerId` see this paddle of `ownerId`? The one rule
 * (docs/features/buddies-and-compare.md): its owner, always; a buddy, unless
 * the owner switched sharing off or hid this paddle; nobody else.
 */
export async function canViewPaddle(viewerId: string | null | undefined, ownerId: string, paddle: { hiddenFromBuddies?: boolean }): Promise<boolean> {
  if (!viewerId) return false
  if (viewerId === ownerId) return true
  if (paddle.hiddenFromBuddies) return false
  if (!(await areBuddies(viewerId, ownerId))) return false
  return (await getBuddySharing(ownerId)).paddles
}

// ---- GDPR.

/** Everything about this user's buddies, for Download my data (ids only). */
export async function exportBuddies(userId: string) {
  const [buddies, requestsIn, requestsOut, sharing] = await Promise.all([
    listBuddies(userId), listIncomingRequests(userId), listOutgoingRequests(userId), getBuddySharing(userId),
  ])
  return { buddies, requestsIn, requestsOut, sharing }
}

/** Account erasure: both sides of every friendship, every request to or from them, their invite. */
export async function eraseBuddies(userId: string): Promise<void> {
  if (!ok(userId)) return
  const [buddies, incoming, outgoing, invite] = await Promise.all([
    listBuddies(userId), listIncomingRequests(userId), listOutgoingRequests(userId),
    getJson<{ token: string }>(myInviteKey(userId)),
  ])
  await deleteObjects([
    ...(await listKeys(`buddies/${userId}/`)),
    ...buddies.map(b => buddyKey(b.userId, userId)),
    ...(await listKeys(`buddy-requests/${userId}/`)), ...incoming.map(r => outKey(r.userId, userId)),
    ...(await listKeys(`buddy-requests-out/${userId}/`)), ...outgoing.map(r => reqKey(r.userId, userId)),
    ...(invite?.token ? [inviteKey(invite.token)] : []),
  ])
}
