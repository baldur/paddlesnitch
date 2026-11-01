import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@paddlesnitch/core/auth'
import { parseTrace, parseFailureMessage } from '@paddlesnitch/timing/parse'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseAndSave } from '@paddlesnitch/analysis/pipeline'
import { type AnalysisSource } from '@paddlesnitch/analysis/analysis-store'
import { loadTrialEntryTrack, listUserTrialEntries } from '@paddlesnitch/analysis/trials'
import { loadDeviceSessionTrack } from '@paddlesnitch/analysis/device-sessions'
import { withAction } from '@/lib/action'

// Analyse a paddle (a file upload, a time-trial entry or a tracker recording),
// narrate it with the history-aware LLM, and SAVE it to the signed-in user's
// library. Auth-gated (personal diary/history) — which also means the LLM
// endpoint isn't public.
//
// The whole body is wrapped so a throw anywhere on the path — a malformed
// upload, a storage blip — becomes a clean, logged error instead of a raw 500
// with a stack. The steps that legitimately fail (weather,
// flow, history, LLM) each degrade on their own so one of them never fails the
// analysis.
async function post(req: NextRequest) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to analyse and save paddles.' }, { status: 401 })

  try {
    return await analysePaddle(req, user.id)
  } catch (err) {
    console.error('[analyse] unhandled error', err)
    return NextResponse.json(
      { error: 'Something went wrong analysing that paddle. Please try again.' },
      { status: 500 },
    )
  }
}

async function analysePaddle(req: NextRequest, userId: string): Promise<NextResponse> {
  const form = await req.formData()

  // ---- resolve the track from a file, a time-trial entry or a recording ----
  let track: TrackPoint[]
  let source: AnalysisSource
  const file = form.get('file')
  const trialEntryId = form.get('trialEntryId')
  const trialId = form.get('trialId')
  const deviceSessionId = form.get('deviceSessionId')
  const deviceIdField = form.get('deviceId')

  if (typeof trialEntryId === 'string' && trialEntryId && typeof trialId === 'string' && trialId) {
    const loaded = await loadTrialEntryTrack(userId, trialId, trialEntryId)
    if (!loaded) return NextResponse.json({ error: 'Couldn’t load that time-trial result.' }, { status: 404 })
    track = loaded
    // Look up the entry's display info so the saved paddle names its course.
    const summary = (await listUserTrialEntries(userId)).find(e => e.entryId === trialEntryId)
    source = { type: 'trial', trialId, entryId: trialEntryId, courseName: summary?.courseName, filename: summary?.filename }
  } else if (typeof deviceSessionId === 'string' && deviceSessionId && typeof deviceIdField === 'string' && deviceIdField) {
    const loaded = await loadDeviceSessionTrack(userId, deviceIdField, deviceSessionId)
    if (!loaded) return NextResponse.json({ error: 'Couldn’t load that tracker recording.' }, { status: 404 })
    track = loaded
    source = { type: 'device', deviceId: deviceIdField, deviceSessionId }
  } else if (file instanceof File && file.size > 0) {
    const parsed = await parseTrace(file.name, await file.arrayBuffer())
    if (!parsed.ok) {
      return NextResponse.json({ error: parseFailureMessage(parsed.reason) }, { status: 422 })
    }
    track = parsed.track
    source = { type: 'file', filename: file.name }
  } else {
    return NextResponse.json({ error: 'Choose a file.' }, { status: 400 })
  }
  if (track.length < 2) return NextResponse.json({ error: 'That file has too few GPS points to analyse.' }, { status: 422 })

  // Shared pipeline: conditions → analysis → duplicate detection → save, with the
  // plain summary. The AI one is written when the paddle page asks
  // (paddles.writeSummary; see pipeline.ts for why not here).
  const { session, duplicate } = await analyseAndSave(userId, track, source)
  return NextResponse.json({
    ...session.result, id: session.id, note: session.note,
    source: session.source, paddledAt: session.paddledAt,
    ...(duplicate ? { duplicate: true } : {}),
  })
}

export const POST = withAction('upload', post)
