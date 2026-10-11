// Saved plans (server only). Private to the paddler, under users/{id}/plans/
// so account deletion's users/ wipe removes them with everything else.
// A plan keeps the inputs, never the computed stops: those come from the
// current dataset each time it's opened, so new data reaches old plans.
import { nanoid } from 'nanoid'
import { deleteObject, getJson, listKeys, putJson } from '@paddlesnitch/core/storage'
import type { PlanInput } from './plan'

export type SavedPlan = PlanInput & {
  id: string
  title: string
  region: string
  createdAt: string
  updatedAt: string
}

export const MAX_PLANS = 200
export const MAX_TITLE = 80

const key = (userId: string, id: string) => `users/${userId}/plans/${id}.json`
const validId = (id: string) => /^[\w-]{1,64}$/.test(id)

export type PlanFields = Omit<SavedPlan, 'id' | 'createdAt' | 'updatedAt'>

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
  if (!(await getPlan(userId, id))) return false
  await deleteObject(key(userId, id))
  return true
}
