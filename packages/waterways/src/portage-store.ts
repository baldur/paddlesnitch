// OpenPortage contributions in storage (server only). The owner's copy lives
// under users/{userId}/portages/ (so account deletion's users/ wipe removes it)
// and a public copy under portages/public/ for everyone's routes; flags under
// portages/flags/{id}/{flagger}. A note waiting on its check has no public
// copy at all: its second copy is under portages/pending/, which nothing public
// reads. See portage.ts.
import { customAlphabet, nanoid } from 'nanoid'
import { deleteObject, deletePrefix, getJson, listKeys, putJson } from '@paddlesnitch/core/storage'
import { FLAGS_TO_HIDE, toPublic, type PortageContribution, type PortageVerdict, type PublicPortage } from './portage'
import { mergeSurvey, surveyPortages } from './portage-survey'

const ownKey = (userId: string, id: string) => `users/${userId}/portages/${id}.json`
const publicKey = (id: string) => `portages/public/${id}.json`
const flagPrefix = (id: string) => `portages/flags/${id}/`
const pendingKey = (id: string) => `portages/pending/${id}.json`
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)
const reviewKey = (ref: string) => `portages/reviews/${ref}.json`
// Letters and digits only: it goes on a command line, so it can't start with a dash.
const newRef = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20)
/** The author's copy never carries the ref: it would tie their note to its public issue. */
const withoutRef = ({ reviewRef: _, ...rest }: PortageContribution): PortageContribution => rest

export type PortageReview = { id: string; issue: number; category: PortageVerdict['category']; decided?: 'published' | 'removed' }
export type ReviewOutcome = 'published' | 'removed' | 'withdrawn'

/** The public copy, or a surveyed one (no userId: it has no owner's copy). */
export { findPublic as getPublicPortage }
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

/** It passed its check. Only ever a pending note: a stale job run can't publish
 *  a held one, or bring back one deleted while the check ran. False if not published. */
export async function publishPortage(id: string): Promise<boolean> {
  const c = await getPendingPortage(id)
  if (c?.status !== 'pending') return false
  if (!(await getJson(ownKey(c.userId, id)))) {
    await deleteObject(pendingKey(id))
    return false
  }
  const { status: _s, verdict: _v, reviewRef: _r, ...rest } = c
  const published: PortageContribution = { ...rest, updatedAt: new Date().toISOString() }
  await putJson(publicKey(id), published)
  await putJson(ownKey(c.userId, id), published)
  // deletePortage clears this key, so it's gone only if the author withdrew it just now.
  if (!(await getJson(pendingKey(id)))) {
    await deleteObject(publicKey(id))
    await deleteObject(ownKey(c.userId, id))
    cache = null
    return false
  }
  await deleteObject(pendingKey(id))
  cache = null
  return true
}

/** Held for the owner. Null when its author withdrew it meanwhile: file no issue for that.
 *  Keeps the ref of an earlier run, so a repeated job can find the issue it filed. */
export async function holdPortage(id: string, verdict: PortageVerdict): Promise<PortageContribution | null> {
  const c = await getPendingPortage(id)
  if (!c) return null
  if (!(await getJson(ownKey(c.userId, id)))) {
    await deleteObject(pendingKey(id))
    return null
  }
  const held: PortageContribution = { ...c, status: 'held', verdict, reviewRef: c.reviewRef ?? newRef(), updatedAt: new Date().toISOString() }
  await putJson(pendingKey(id), held)
  await putJson(ownKey(c.userId, id), withoutRef(held))
  return held
}

/** A note hidden by flags, with the ref for its review issue. Null when it isn't hidden. */
export async function setReviewRefOnHidden(id: string): Promise<PortageContribution | null> {
  if (!validId(id)) return null
  const c = await findPublic(id)
  if (!c?.hidden) return null
  if (c.reviewRef) return c
  const next = { ...c, reviewRef: newRef() }
  await putJson(publicKey(id), next)
  return next
}

/** Remember which issue a ref belongs to, once it's filed. */
export async function recordReview(ref: string, id: string, issue: number, category: PortageVerdict['category']): Promise<void> {
  await putJson(reviewKey(ref), { id, issue, category } satisfies PortageReview)
}

export async function getReview(ref: string): Promise<PortageReview | null> {
  return validId(ref) ? getJson<PortageReview>(reviewKey(ref)) : null
}

/** The note a ref points at, waiting or hidden; null when it's gone. */
export async function getReviewedPortage(ref: string): Promise<PortageContribution | null> {
  const mark = await getReview(ref)
  if (!mark) return null
  const waiting = await getPendingPortage(mark.id)
  if (waiting?.reviewRef === ref) return waiting
  const shown = await getJson<PortageContribution>(publicKey(mark.id))
  return shown?.reviewRef === ref ? shown : null
}

/** The owner's decision. The ref and its mark stay until finishReview, once the
 *  issue is closed, so a failed close can be re-run; a re-run repeats the outcome. */
export async function reviewPortage(ref: string, decision: 'publish' | 'remove'): Promise<{ outcome: ReviewOutcome; issue: number } | null> {
  const mark = await getReview(ref)
  if (!mark) return null
  if (mark.decided) return { outcome: mark.decided, issue: mark.issue }
  const c = await getReviewedPortage(ref)
  if (!c) return { outcome: 'withdrawn', issue: mark.issue }
  const outcome = decision === 'publish' ? 'published' : 'removed'
  if (decision === 'publish') await releasePortage(c)
  else await removePortage(c)
  await putJson(reviewKey(ref), { ...mark, decided: outcome } satisfies PortageReview)
  cache = null
  return { outcome, issue: mark.issue }
}

/** After the issue is closed: forget the ref, so a later round of flags gets a new one. */
export async function finishReview(ref: string): Promise<void> {
  const mark = await getReview(ref)
  if (!mark) return
  const shown = await getJson<PortageContribution>(publicKey(mark.id))
  if (shown?.reviewRef === ref) await putJson(publicKey(mark.id), withoutRef(shown))
  await deleteObject(reviewKey(ref))
  cache = null
}

/** Let a held note through, or restore one hidden by flags. Keeps the ref on the public copy until finishReview. */
async function releasePortage(c: PortageContribution) {
  if (c.status === undefined) { await setHidden(c, false); await deletePrefix(flagPrefix(c.id)); return }
  const { status: _s, verdict: _v, ...rest } = c
  const published = { ...rest, updatedAt: new Date().toISOString() }
  await putJson(publicKey(c.id), published)
  await putJson(ownKey(c.userId, c.id), withoutRef(published))
  await deleteObject(pendingKey(c.id))
}

async function removePortage(c: PortageContribution) {
  // A surveyed portage has no author: it stays hidden until the committed file is corrected.
  if (!c.userId) return
  const { verdict: _v, hidden: _h, ...rest } = withoutRef(c)
  await putJson(ownKey(c.userId, c.id), { ...rest, status: 'not_published', updatedAt: new Date().toISOString() })
  await deleteObject(pendingKey(c.id))
  await deleteObject(publicKey(c.id))
  await deletePrefix(flagPrefix(c.id))
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
  if (c.userId) await putJson(ownKey(c.userId, c.id), withoutRef(next))
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
