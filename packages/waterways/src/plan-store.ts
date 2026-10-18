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
import { haversine } from '@paddlesnitch/timing/geo'
import type { PlanInput } from './plan'
import type { LatLng } from './types'

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
// Which locks and portages a saved plan passes, for ranking the gaps that
// matter most (/plan/gaps). Only counts are ever shown; deleted with the plan
// and the account.
const demandKey = (planId: string) => `plans/demand/${planId}.json`
type Demand = { userId: string; ids: string[]; line?: LatLng[] }
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
  await deleteObject(demandKey(id))
  await deleteObject(key(userId, id))
  return true
}

/** A point about every stepM along a line, ends included, at most `max`: enough
 *  to tell which waterways a route travels without keeping the route. */
export function sampleLine(line: LatLng[], stepM = 1000, max = 400): LatLng[] {
  if (line.length < 2) return line.slice()
  const out: LatLng[] = [line[0]]
  let run = 0
  for (let i = 1; i < line.length; i++) {
    run += haversine(line[i - 1], line[i])
    if (run >= stepM) { out.push(line[i]); run = 0 }
  }
  if (out[out.length - 1] !== line[line.length - 1]) out.push(line[line.length - 1])
  const every = Math.ceil(out.length / max)
  return (every > 1 ? out.filter((_, i) => i % every === 0 || i === out.length - 1) : out)
    .map(([a, b]) => [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4] as LatLng)
}

/** Record the locks and portages a saved plan passes (feature ids), and a
 *  coarse sample of its route for ranking waterways by how often they're planned. */
export async function recordPlanDemand(userId: string, planId: string, ids: string[], line: LatLng[] = []): Promise<void> {
  await putJson(demandKey(planId), { userId, ids: [...new Set(ids)], line: sampleLine(line) } satisfies Demand)
  demandCache = null
}

let demandCache: { at: number; counts: Map<string, number>; lines: LatLng[][] } | null = null
/** Tests start each case on empty storage; the cache mustn't outlive that. */
export const clearDemandCache = () => { demandCache = null }

/** How many saved plans pass each lock or portage (feature id → plans).
 *  Read across every plan's record and kept an hour per server instance. */
export async function planDemand(): Promise<Map<string, number>> {
  return (await readDemand()).counts
}

/** Every saved plan's sampled route (same cache). The same array until the
 *  cache refreshes, so callers can tell when to recompute. */
export async function planLines(): Promise<LatLng[][]> {
  return (await readDemand()).lines
}

async function readDemand() {
  if (demandCache && Date.now() - demandCache.at < 3_600_000) return demandCache
  const counts = new Map<string, number>()
  const lines: LatLng[][] = []
  for (const k of await listKeys('plans/demand/')) {
    const d = await getJson<Demand>(k)
    for (const id of d?.ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
    if (d?.line?.length) lines.push(d.line)
  }
  demandCache = { at: Date.now(), counts, lines }
  return demandCache
}

/** Account deletion: their plans' demand records (the plans go with users/{id}/). */
export async function erasePlanDemand(userId: string): Promise<void> {
  for (const p of await listPlans(userId)) await deleteObject(demandKey(p.id))
  demandCache = null
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
