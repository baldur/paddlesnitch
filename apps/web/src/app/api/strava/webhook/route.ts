import { NextRequest, NextResponse, after } from 'next/server'
import { getWebhookVerifyToken } from '@paddlesnitch/core/strava'
import {
  getUserIdByAthleteId, getStravaAutoImport,
  deleteStravaTokens, deleteAthleteIndex,
} from '@paddlesnitch/core/strava-storage'
import { importStravaActivity } from '@paddlesnitch/analysis/strava-import'

// Strava Webhook Events API callback (docs/features/strava-auto-import.md).
// Public + unauthenticated by design — Strava is the caller. Two jobs:
//  - GET  : the one-time subscription validation handshake (echo hub.challenge).
//  - POST : an event. We ACK 200 immediately (Strava needs a response within
//           ~2s and retries otherwise) and do the real work in after().

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

type StravaEvent = {
  object_type?: 'activity' | 'athlete'
  aspect_type?: 'create' | 'update' | 'delete'
  object_id?: number
  owner_id?: number
  updates?: Record<string, string>
}

// POST: an event. Always answer 200 fast; process afterwards so a slow import
// (activity fetch + analysis + LLM) never holds Strava's request open.
export async function POST(req: NextRequest) {
  let event: StravaEvent | null = null
  try { event = (await req.json()) as StravaEvent } catch { /* malformed — ack anyway */ }

  if (event?.owner_id) {
    const ev = event
    after(() => processEvent(ev))
  }
  return NextResponse.json({ ok: true })
}

async function processEvent(ev: StravaEvent): Promise<void> {
  try {
    const ownerId = ev.owner_id!

    // Athlete deauthorised the app → treat like Disconnect: drop tokens + index
    // so we hold no credentials and make no further calls for them. (Strava
    // guideline compliance.)
    if (ev.object_type === 'athlete' && ev.updates?.authorized === 'false') {
      const userId = await getUserIdByAthleteId(ownerId)
      if (userId) {
        await deleteStravaTokens(userId)
        await deleteAthleteIndex(ownerId)
        console.log(`[strava webhook] deauthorized athlete ${ownerId} → disconnected user`)
      }
      return
    }

    // A new activity → auto-import it as a paddle if the owner is a connected
    // user who has auto-import enabled. importStravaActivity filters to water
    // sports and de-dupes, so non-paddles / re-sends are no-ops.
    if (ev.object_type === 'activity' && ev.aspect_type === 'create' && ev.object_id) {
      const userId = await getUserIdByAthleteId(ownerId)
      if (!userId) return                                   // not one of our users
      if (!(await getStravaAutoImport(userId))) return      // opted out
      const outcome = await importStravaActivity(userId, ev.object_id)
      console.log(`[strava webhook] activity ${ev.object_id} for user → ${outcome.status}`)
    }
    // activity update/delete and other events are intentionally ignored (v1).
  } catch (err) {
    console.error('[strava webhook] processing failed', err)
  }
}
