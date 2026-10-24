// GET /api/v1/trials: public time trials, newest first (#511). Only what an
// anonymous visitor sees listed on the site.
import { NextRequest } from 'next/server'
import { listCourses, listTrials } from '@/lib/catalogue'
import { isListedForViewer } from '@/lib/permissions'
import { ok, options, trialSummary } from '@/lib/api-v1'

export const dynamic = 'force-dynamic'
export const OPTIONS = options

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')
  const [trials, courses] = await Promise.all([listTrials(), listCourses()])
  const byId = new Map(courses.map(c => [c.id, c]))
  const listed = trials
    .filter(t => isListedForViewer(t, null))
    .filter(t => status !== 'open' && status !== 'closed' ? true : t.status === status)
    .sort((a, b) => b.date.localeCompare(a.date))
  return ok({ trials: listed.map(t => trialSummary(t, byId.get(t.courseId) ?? null, req.nextUrl.origin)) })
}
