// OpenPortage contributions in storage (server only). The owner's copy lives
// under users/{userId}/portages/ (so account deletion's users/ wipe removes it)
// and a public copy under portages/public/ for everyone's routes; flags under
// portages/flags/{id}/{flagger}. A note waiting on its check has no public
// copy at all: its second copy is under portages/pending/, which nothing public
// reads. See portage.ts.
import { nanoid } from 'nanoid'
import { deleteObject, deletePrefix, getJson, listKeys, putJson } from '@paddlesnitch/core/storage'
import { FLAGS_TO_HIDE, toPublic, type PortageContribution, type PortageVerdict, type PublicPortage } from './portage'
import { mergeSurvey, surveyPortages } from './portage-survey'

const ownKey = (userId: string, id: string) => `users/${userId}/portages/${id}.json`
const publicKey = (id: string) => `portages/public/${id}.json`
const flagPrefix = (id: string) => `portages/flags/${id}/`
const pendingKey = (id: string) => `portages/pending/${id}.json`
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)

/** The public copy, or a surveyed one (no userId: it has no owner's copy). */
async function findPublic(id: string): Promise<PortageContribution | null> {
  const c = await getJson<PortageContribution>(publicKey(id))
  if (c) return c
  const surveyed = surveyPortages.find(s => s.id === id)
  return surveyed ? { ...surveyed, userId: '' } : null
}

export type PortageFields = Pick<PortageContribution, 'featureId' | 'at' | 'landings' | 'notes' | 'rollers'>

export async function addPortage(user: { id: string; name: string }, fields: PortageFields): Promise<PortageContribution> {
  const now = new Date().toISOString()
  const c: PortageContribution = { ...fields, id: nanoid(12), userId: user.id, name: user.name, licence: 'CC0-1.0', createdAt: now, updatedAt: now }
  await putJson(ownKey(user.id, c.id), c)
  await putJson(publicKey(c.id), c)
  cache = null
  return c
}

/** A contribution with a note: saved for its author, public only once it passes. */
export async function addPendingPortage(user: { id: string; name: string }, fields: PortageFields): Promise<PortageContribution> {
  const now = new Date().toISOString()
  const c: PortageContribution = { ...fields, id: nanoid(12), userId: user.id, name: user.name, licence: 'CC0-1.0', createdAt: now, updatedAt: now, status: 'pending' }
  await putJson(ownKey(user.id, c.id), c)
  await putJson(pendingKey(c.id), c)
  return c
}

/** One waiting on its check or on a decision; null once decided or withdrawn. */
export async function getPendingPortage(id: string): Promise<PortageContribution | null> {
  return validId(id) ? getJson<PortageContribution>(pendingKey(id)) : null
}

/** Everything waiting on its check or on a decision, oldest first. */
export async function listPendingPortages(): Promise<PortageContribution[]> {
  const all = await Promise.all((await listKeys('portages/pending/')).map(k => getJson<PortageContribution>(k)))
  return all.filter((c): c is PortageContribution => !!c).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** It passed, or the owner let it through. False when it's no longer waiting. */
export async function publishPortage(id: string): Promise<boolean> {
  const c = await getPendingPortage(id)
  if (!c) return false
  const { status: _s, verdict: _v, ...rest } = c
  const published: PortageContribution = { ...rest, updatedAt: new Date().toISOString() }
  await putJson(ownKey(c.userId, id), published)
  await putJson(publicKey(id), published)
  await deleteObject(pendingKey(id))
  cache = null
  return true
}

/** Held for the owner. Null when its author withdrew it meanwhile: file no issue for that. */
export async function holdPortage(id: string, verdict: PortageVerdict): Promise<PortageContribution | null> {
  const c = await getPendingPortage(id)
  if (!c) return null
  if (!(await getJson(ownKey(c.userId, id)))) {
    await deleteObject(pendingKey(id))
    return null
  }
  const held: PortageContribution = { ...c, status: 'held', verdict, updatedAt: new Date().toISOString() }
  await putJson(pendingKey(id), held)
  await putJson(ownKey(c.userId, id), held)
  return held
}

/** The owner's decision on a note that's waiting or was hidden by flags. Null when there's nothing to decide. */
export async function reviewPortage(id: string, decision: 'publish' | 'remove'): Promise<'published' | 'removed' | null> {
  if (!validId(id)) return null
  const waiting = await getPendingPortage(id)
  if (decision === 'publish') {
    if (waiting) return (await publishPortage(id)) ? 'published' : null
    const c = await getJson<PortageContribution>(publicKey(id))
    return c?.hidden && (await hidePortage(id, false)) ? 'published' : null
  }
  const c = waiting ?? await getJson<PortageContribution>(publicKey(id))
  if (!c?.userId || (!waiting && !c.hidden)) return null
  const { verdict: _v, hidden: _h, ...rest } = c
  await putJson(ownKey(c.userId, id), { ...rest, status: 'not_published', updatedAt: new Date().toISOString() })
  await deleteObject(pendingKey(id))
  await deleteObject(publicKey(id))
  await deletePrefix(flagPrefix(id))
  cache = null
  return 'removed'
}

export async function listMyPortages(userId: string): Promise<PortageContribution[]> {
  const keys = await listKeys(`users/${userId}/portages/`)
  const all = await Promise.all(keys.map(k => getJson<PortageContribution>(k)))
  return all.filter((c): c is PortageContribution => !!c).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The owner withdraws one: it stops being shown. False when it isn't theirs. */
export async function deletePortage(userId: string, id: string): Promise<boolean> {
  if (!validId(id) || !(await getJson(ownKey(userId, id)))) return false
  await deleteObject(publicKey(id))
  await deleteObject(pendingKey(id))
  await deleteObject(ownKey(userId, id))
  cache = null
  return true
}

/** One flag per person; enough of them hide it until an admin looks. */
export async function flagPortage(flaggerId: string, id: string): Promise<'flagged' | 'hidden' | null> {
  if (!validId(id)) return null
  const c = await findPublic(id)
  if (!c) return null
  await putJson(`${flagPrefix(id)}${flaggerId}.json`, { at: new Date().toISOString() })
  if ((await listKeys(flagPrefix(id))).length < FLAGS_TO_HIDE || c.hidden) return 'flagged'
  await setHidden(c, true)
  return 'hidden'
}

/** An admin hides or restores one (and clears its flags when restoring). */
export async function hidePortage(id: string, hidden: boolean): Promise<boolean> {
  if (!validId(id)) return false
  const c = await findPublic(id)
  if (!c) return false
  await setHidden(c, hidden)
  if (!hidden) await deletePrefix(flagPrefix(id))
  return true
}

async function setHidden(c: PortageContribution, hidden: boolean) {
  const next = { ...c, hidden: hidden || undefined }
  await putJson(publicKey(c.id), next)
  if (c.userId) await putJson(ownKey(c.userId, c.id), next)
  cache = null
}

// Every route reads these: keep them a minute per server instance.
let cache: { at: number; list: PublicPortage[] } | null = null
const CACHE_MS = 60_000

/** Tests start each case on empty storage; the cache mustn't outlive that. */
export const clearPortageCache = () => { cache = null }

/** Every public contribution (hidden ones included, marked), without user ids. */
export async function listPublicPortages(): Promise<PublicPortage[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list
  const keys = await listKeys('portages/public/')
  const all = await Promise.all(keys.map(k => getJson<PortageContribution>(k)))
  // A status here would be a bug: nothing waiting on a check may be public, so it's dropped.
  const list = mergeSurvey(all.filter((c): c is PortageContribution => !!c && !c.status).map(toPublic))
  cache = { at: Date.now(), list }
  return list
}

/** Account deletion: the public copies and flags (the owner's copies go with users/{id}/). */
export async function erasePortages(userId: string): Promise<void> {
  for (const c of await listMyPortages(userId)) {
    await deleteObject(publicKey(c.id))
    await deleteObject(pendingKey(c.id))
    await deletePrefix(flagPrefix(c.id))
  }
  cache = null
}
