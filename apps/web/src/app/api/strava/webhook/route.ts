import { NextRequest, NextResponse } from 'next/server'
import { getWebhookVerifyToken } from '@paddlesnitch/core/strava'
import type { StravaEvent } from '@/lib/strava-webhook'
import { enqueueJob } from '@/lib/jobs'

// Strava Webhook Events API callback (docs/features/strava-auto-import.md).
// Public + unauthenticated by design — Strava is the caller. Two jobs:
//  - GET  : the one-time subscription validation handshake (echo hub.challenge).
//  - POST : an event. We ACK 200 immediately (Strava needs a response within
//           ~2s and retries otherwise) after writing a job; the work runs
//           separately (lib/jobs.ts, #413).

// GET /api/strava/webhook?hub.mode=subscribe&hub.challenge=…&hub.verify_token=…
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const mode = p.get('hub.mode')
  const challenge = p.get('hub.challenge')
  const token = p.get('hub.verify_token')

  const expected = await getWebhookVerifyToken()
  if (mode === 'subscribe' && challenge && expected && token === expected) {
    return NextResponse.json({ 'hub.challenge': challenge })
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

// POST: an event. Always answer 200 fast: write a job (one small S3 write) and
// answer; the import runs as that job, never holding Strava's request open.
export async function POST(req: NextRequest) {
  let event: StravaEvent | null = null
  try { event = (await req.json()) as StravaEvent } catch { /* malformed — ack anyway */ }

  if (event?.owner_id) {
    await enqueueJob('strava-event', event)
  }
  return NextResponse.json({ ok: true })
}

