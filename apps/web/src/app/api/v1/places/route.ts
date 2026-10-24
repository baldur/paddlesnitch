// GET /api/v1/places?q=: locks, wharves, slipways and towns on the water, by
// name: the planner's Start/Finish search (#506), for choosing a plan's ends.
import { NextRequest } from 'next/server'
import { findOnWater } from '@paddlesnitch/waterways/find'
import { loadNational } from '@paddlesnitch/waterways/national'
import { attribution, fail, latLngParam, ok, options, placeResponse } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'
export const OPTIONS = options

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim() ?? ''
  if (q.length < 2 || q.length > 100) return fail(400, 'bad_request', 'q is 2 to 100 characters.')
  const near = latLngParam(sp.get('near'))
  if (sp.has('near') && !near) return fail(400, 'bad_request', 'near is "lat,lng".')
  const waterway = sp.get('waterway')?.replace(/-/g, ' ') || undefined
  const found = findOnWater(await loadNational(), q, { near: near ?? undefined, waterway })
  return ok({ places: found.map(placeResponse), attribution: attribution([]) }, 300)
}
