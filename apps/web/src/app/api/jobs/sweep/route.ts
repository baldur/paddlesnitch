import { NextResponse } from 'next/server'
import { rateLimit } from '@paddlesnitch/core/rate-limit'
import { sweepJobs } from '@/lib/jobs'

// POST /api/jobs/sweep — called by the jobs kicker every 5 minutes: runs jobs
// that are due (retries, ones waiting for a time, any whose announcement was
// lost). Public for the same reason as /api/jobs/run; capped well above the
// timer's 1 per 5 minutes.
export async function POST() {
  if (!(await rateLimit('jobs-sweep', 10, 300)).allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  return NextResponse.json(await sweepJobs())
}
