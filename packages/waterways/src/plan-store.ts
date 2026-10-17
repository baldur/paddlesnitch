// Saved plans (server only). Private to the paddler, under users/{id}/plans/
// so account deletion's users/ wipe removes them with everything else.
// A plan keeps the inputs, never the computed stops: those come from the
// current dataset each time it's opened, so new data reaches old plans.
//
// Sharing: a shared plan has a `shareId`. Anyone with its link may view it,
// and the owner's buddies see it listed. An index under plans/shared/ maps the
// link to the plan, so the owner's id never appears in the URL.
import { nanoid } from 'nanoid'
import { deleteObject, getJson, listKeys, putJson } from '@paddlesnitch/core/storage'
import type { PlanInput } from './plan'

export type SavedPlan = PlanInput & {
  id: string
  title: string
  region: string
  createdAt: string
  updatedAt: string
  shareId?: string
  /** The paddler's own notes: on the whole plan, and on stops (by feature id).
   *  Private, but a shared plan's link shows them (the crew wants them). */
  notes?: string
  stopNotes?: Record<string, string>
}

export const MAX_PLANS = 200
export const MAX_TITLE = 80
export const MAX_PLAN_NOTES = 2000
export const MAX_STOP_NOTE = 500
export const MAX_STOP_NOTES = 300

const key = (userId: string, id: string) => `users/${userId}/plans/${id}.json`
const sharedKey = (shareId: string) => `plans/shared/${shareId}.json`
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)
type ShareIndex = { userId: string; planId: string }

export type PlanFields = Omit<SavedPlan, 'id' | 'createdAt' | 'updatedAt' | 'shareId' | 'notes' | 'stopNotes'>

/** Create, or update the plan with `id`. Null when `id` isn't one of theirs. */
export async function savePlan(userId: string, fields: PlanFields, id?: string): Promise<SavedPlan | null | 'too_many'> {
  const now = new Date().toISOString()
  const prev = id ? await getPlan(userId, id) : null
  if (id && !prev) return null
  if (!prev && (await listKeys(`users/${userId}/plans/`)).length >= MAX_PLANS) return 'too_many'
  const plan: SavedPlan = {
    ...fields,
    title: fields.title.trim().slice(0, MAX_TITLE) || 'Untitled plan',
    id: prev?.id ?? nanoid(10),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    ...(prev?.shareId ? { shareId: prev.shareId } : {}),
    ...(prev?.notes ? { notes: prev.notes } : {}),
    ...(prev?.stopNotes ? { stopNotes: prev.stopNotes } : {}),
  }
  await putJson(key(userId, plan.id), plan)
  return plan
}

export async function getPlan(userId: string, id: string): Promise<SavedPlan | null> {
  return validId(id) ? getJson<SavedPlan>(key(userId, id)) : null
}

/** Newest first. */
export async function listPlans(userId: string): Promise<SavedPlan[]> {
  const keys = await listKeys(`users/${userId}/plans/`)
  const all = await Promise.all(keys.map(k => getJson<SavedPlan>(k)))
  return all.filter((p): p is SavedPlan => !!p).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deletePlan(userId: string, id: string): Promise<boolean> {
  const plan = await getPlan(userId, id)
  if (!plan) return false
  if (plan.shareId) await deleteObject(sharedKey(plan.shareId))
  await deleteObject(key(userId, id))
  return true
}

/** Set the plan's own note, and/or one stop's (empty text removes it). Null
 *  when the plan isn't theirs, 'too_many' past MAX_STOP_NOTES stops. */
export async function setPlanNotes(
  userId: string, id: string, patch: { notes?: string; stop?: { featureId: string; text: string } },
): Promise<SavedPlan | null | 'too_many'> {
  const plan = await getPlan(userId, id)
  if (!plan) return null
  const next: SavedPlan = { ...plan, updatedAt: new Date().toISOString() }
  if (patch.notes !== undefined) {
    const n = patch.notes.trim().slice(0, MAX_PLAN_NOTES)
    if (n) next.notes = n; else delete next.notes
  }
  if (patch.stop) {
    const stopNotes = { ...plan.stopNotes }
    const t = patch.stop.text.trim().slice(0, MAX_STOP_NOTE)
    if (t) stopNotes[patch.stop.featureId] = t; else delete stopNotes[patch.stop.featureId]
    if (Object.keys(stopNotes).length > MAX_STOP_NOTES) return 'too_many'
    if (Object.keys(stopNotes).length) next.stopNotes = stopNotes; else delete next.stopNotes
  }
  await putJson(key(userId, id), next)
  return next
}

/** Give a plan a link (the same one if it already has one). */
export async function sharePlan(userId: string, id: string): Promise<SavedPlan | null> {
  const plan = await getPlan(userId, id)
  if (!plan) return null
  if (plan.shareId) return plan
  const shared = { ...plan, shareId: nanoid() }
  await putJson(sharedKey(shared.shareId), { userId, planId: id } satisfies ShareIndex)
  await putJson(key(userId, id), shared)
  return shared
}

/** Stop sharing: the link stops working and buddies stop seeing it. */
export async function unsharePlan(userId: string, id: string): Promise<SavedPlan | null> {
  const plan = await getPlan(userId, id)
  if (!plan) return null
  if (!plan.shareId) return plan
  await deleteObject(sharedKey(plan.shareId))
  const { shareId: _, ...rest } = plan
  await putJson(key(userId, id), rest)
  return rest
}

/** The plan behind a link, or null when the link is unknown or was withdrawn. */
export async function getSharedPlan(shareId: string): Promise<{ userId: string; plan: SavedPlan } | null> {
  if (!validId(shareId)) return null
  const idx = await getJson<ShareIndex>(sharedKey(shareId))
  if (!idx) return null
  const plan = await getPlan(idx.userId, idx.planId)
  return plan?.shareId === shareId ? { userId: idx.userId, plan } : null
}

/** Account deletion: the share links (the plans go with users/{id}/). */
export async function erasePlanShares(userId: string): Promise<void> {
  for (const p of await listPlans(userId)) if (p.shareId) await deleteObject(sharedKey(p.shareId))
}
