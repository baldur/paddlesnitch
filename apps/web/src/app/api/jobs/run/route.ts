import { NextResponse } from 'next/server'
import { rateLimit } from '@paddlesnitch/core/rate-limit'
import { runJob } from '@/lib/jobs'

// POST /api/jobs/run { key } — called by the jobs kicker when S3 announces a
// new job file (lib/jobs.ts, #413). Public on purpose: it only runs a job that
// already exists as a file, and running one twice is harmless, so there is no
// secret to keep. A cap stops it being hammered.
export async function POST(req: Request) {
  if (!(await rateLimit('jobs-run', 600, 300)).allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null
  if (typeof body?.key !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  return NextResponse.json({ outcome: await runJob(body.key) })
}
