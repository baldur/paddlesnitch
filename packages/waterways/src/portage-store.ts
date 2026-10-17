// OpenPortage contributions in storage (server only). The owner's copy lives
// under users/{userId}/portages/ (so account deletion's users/ wipe removes it)
// and a public copy under portages/public/ for everyone's routes; flags under
// portages/flags/{id}/{flagger}. See portage.ts.
import { nanoid } from 'nanoid'
import { deleteObject, deletePrefix, getJson, listKeys, putJson } from '@paddlesnitch/core/storage'
import { FLAGS_TO_HIDE, toPublic, type PortageContribution, type PublicPortage } from './portage'

const ownKey = (userId: string, id: string) => `users/${userId}/portages/${id}.json`
const publicKey = (id: string) => `portages/public/${id}.json`
const flagPrefix = (id: string) => `portages/flags/${id}/`
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)

export type PortageFields = Pick<PortageContribution, 'featureId' | 'at' | 'landings' | 'notes' | 'rollers'>

export async function addPortage(user: { id: string; name: string }, fields: PortageFields): Promise<PortageContribution> {
  const now = new Date().toISOString()
  const c: PortageContribution = { ...fields, id: nanoid(12), userId: user.id, name: user.name, licence: 'CC0-1.0', createdAt: now, updatedAt: now }
  await putJson(ownKey(user.id, c.id), c)
  await putJson(publicKey(c.id), c)
  cache = null
  return c
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
  await deleteObject(ownKey(userId, id))
  cache = null
  return true
}

/** One flag per person; enough of them hide it until an admin looks. */
export async function flagPortage(flaggerId: string, id: string): Promise<'flagged' | 'hidden' | null> {
  if (!validId(id)) return null
  const c = await getJson<PortageContribution>(publicKey(id))
  if (!c) return null
  await putJson(`${flagPrefix(id)}${flaggerId}.json`, { at: new Date().toISOString() })
  if ((await listKeys(flagPrefix(id))).length < FLAGS_TO_HIDE || c.hidden) return 'flagged'
  await setHidden(c, true)
  return 'hidden'
}

/** An admin hides or restores one (and clears its flags when restoring). */
export async function hidePortage(id: string, hidden: boolean): Promise<boolean> {
  if (!validId(id)) return false
  const c = await getJson<PortageContribution>(publicKey(id))
  if (!c) return false
  await setHidden(c, hidden)
  if (!hidden) await deletePrefix(flagPrefix(id))
  return true
}

async function setHidden(c: PortageContribution, hidden: boolean) {
  const next = { ...c, hidden: hidden || undefined }
  await putJson(publicKey(c.id), next)
  await putJson(ownKey(c.userId, c.id), next)
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
  const list = all.filter((c): c is PortageContribution => !!c).map(toPublic)
  cache = { at: Date.now(), list }
  return list
}

/** Account deletion: the public copies and flags (the owner's copies go with users/{id}/). */
export async function erasePortages(userId: string): Promise<void> {
  for (const c of await listMyPortages(userId)) {
    await deleteObject(publicKey(c.id))
    await deletePrefix(flagPrefix(c.id))
  }
  cache = null
}
