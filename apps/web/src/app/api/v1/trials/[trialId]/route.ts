// GET /api/v1/trials/{id}: one public trial and its course (#511). A trial an
// anonymous visitor can't see is 404, as on the site.
import { NextRequest } from 'next/server'
import { getJson } from '@/lib/storage'
import { canViewTrial } from '@/lib/permissions'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'
import { fail, ok, options, trialSummary } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'
export const OPTIONS = options

export async function GET(req: NextRequest, { params }: { params: Promise<{ trialId: string }> }) {
  const { trialId } = await params
  const trial = /^[A-Za-z0-9_-]{1,64}$/.test(trialId) ? await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`) : null
  if (!trial || !canViewTrial(trial, null)) return fail(404, 'not_found', 'No such public trial.')
  const course = await getJson<CourseMetadata>(`courses/${trial.courseId}/metadata.json`)
  return ok({ trial: trialSummary(trial, course, req.nextUrl.origin) })
}
