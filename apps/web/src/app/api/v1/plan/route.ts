// GET /api/v1/plan: a route and every stop along it, timed (#511). Takes the
// same parameters as a /plan link: ends by lat,lng or by name (#508).
import { NextRequest } from 'next/server'
import { resolveEnd } from '@paddlesnitch/waterways/find'
import { simplify } from '@paddlesnitch/waterways/line'
import { loadNational } from '@paddlesnitch/waterways/national'
import { DEFAULT_PACE_KMH, DEFAULT_PORTAGE_MINUTES, routePlan, timePlan } from '@paddlesnitch/waterways/plan'
import { listPublicPortages } from '@paddlesnitch/waterways/portage-store'
import { fail, ok, options, planResponse } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'
export const OPTIONS = options

const PLAN_ERRORS = {
  start_off_water: 'The start is not on any river or canal we cover.',
  finish_off_water: 'The finish is not on any river or canal we cover.',
  too_short: 'The start and finish are too close together to be a trip.',
  not_connected: 'There is no paddling route between the start and the finish.',
} as const

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const from = sp.get('from')?.trim(), to = sp.get('to')?.trim()
  if (!from || !to) return fail(400, 'bad_request', 'Give both ends: from and to, each "lat,lng" or a place name.')
  const shape = sp.get('shape') ?? 'one_way'
  if (shape !== 'one_way' && shape !== 'return') return fail(400, 'bad_request', 'shape is one_way or return.')
  const paceKmh = sp.has('pace') ? Number(sp.get('pace')) : DEFAULT_PACE_KMH
  if (!(paceKmh >= 1 && paceKmh <= 30)) return fail(400, 'bad_request', 'pace is km/h, from 1 to 30.')
  const portageMinutes = sp.has('portage') ? Number(sp.get('portage')) : DEFAULT_PORTAGE_MINUTES
  if (!(portageMinutes >= 0 && portageMinutes <= 120)) return fail(400, 'bad_request', 'portage is minutes per portage, from 0 to 120.')
  const at = sp.get('at') ?? undefined
  if (at && (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at)))) return fail(400, 'bad_request', 'at is an ISO 8601 date and time, with an offset.')
  const startAt = at ? new Date(at).toISOString() : undefined

  const ds = await loadNational()
  const waterway = sp.get('waterway')?.replace(/-/g, ' ') || undefined
  const end = (v: string, near?: [number, number]) => resolveEnd(ds, v, { waterway, near }) ?? (waterway ? resolveEnd(ds, v, { near }) : null)
  const start = end(from)
  if (!start) return fail(404, 'not_found', `Couldn't find "${from}" on the water.`)
  const finish = end(to, start)
  if (!finish) return fail(404, 'not_found', `Couldn't find "${to}" on the water.`)

  const routed = routePlan(ds, { start, finish, shape }, [...await listPublicPortages(), ...ds.portages])
  if (typeof routed === 'string') return fail(422, routed, PLAN_ERRORS[routed])
  const plan = timePlan({ ...routed, line: simplify(routed.line, 8) }, { paceKmh, portageMinutes, startAt })
  return ok(planResponse(plan, { from: start, to: finish, shape, paceKmh, portageMinutes, startAt }, req.nextUrl.origin), 300)
}
