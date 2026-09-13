import { NextRequest, NextResponse, after } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { getActivityStreams, streamsToTrack } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { parseTrace } from '@paddlesnitch/timing/parse'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseAndSave } from '@paddlesnitch/analysis/pipeline'
import { type AnalysisSource } from '@paddlesnitch/analysis/analysis-store'
import { loadTrialEntryTrack, listUserTrialEntries } from '@paddlesnitch/analysis/trials'
import { loadDeviceSessionTrack } from '@paddlesnitch/analysis/device-sessions'

// Analyse a paddle (file upload OR Strava activity), narrate it with the
// history-aware LLM, and SAVE it to the signed-in user's library. Auth-gated
// (personal diary/history) — which also means the LLM endpoint isn't public.
//
// The whole body is wrapped so a throw anywhere on the path — a malformed
// upload, a Strava API hiccup, a storage blip — becomes a clean, logged error
// instead of a raw 500 with a stack. The steps that legitimately fail (weather,
// flow, history, LLM) each degrade on their own so one of them never fails the
// analysis.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
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

  // ---- resolve the track from a file or a Strava activity ----
  let track: TrackPoint[]
  let source: AnalysisSource
  const file = form.get('file')
  const stravaId = Number(form.get('stravaActivityId'))
  const trialEntryId = form.get('trialEntryId')
  const trialId = form.get('trialId')
  const deviceSessionId = form.get('deviceSessionId')
  const deviceIdField = form.get('deviceId')

  if (typeof trialEntryId === 'string' && trialEntryId && typeof trialId === 'string' && trialId) {
    const loaded = await loadTrialEntryTrack(userId, trialId, trialEntryId)
    if (!loaded) return NextResponse.json({ error: 'Could not load that time-trial entry.' }, { status: 404 })
    track = loaded
    // Look up the entry's display info so the saved paddle names its course.
    const summary = (await listUserTrialEntries(userId)).find(e => e.entryId === trialEntryId)
    source = { type: 'trial', trialId, entryId: trialEntryId, courseName: summary?.courseName, filename: summary?.filename }
  } else if (typeof deviceSessionId === 'string' && deviceSessionId && typeof deviceIdField === 'string' && deviceIdField) {
    const loaded = await loadDeviceSessionTrack(userId, deviceIdField, deviceSessionId)
    if (!loaded) return NextResponse.json({ error: 'Could not load that device session.' }, { status: 404 })
    track = loaded
    source = { type: 'device', deviceId: deviceIdField, deviceSessionId }
  } else if (file instanceof File && file.size > 0) {
    const parsed = await parseTrace(file.name, await file.arrayBuffer())
    if (!parsed.ok) {
      const msg: Record<string, string> = {
        kml_no_timing: 'KML has no timestamps — export GPX, FIT, or TCX instead.',
        unknown_format: 'Unsupported file type. Use GPX, FIT, TCX, CSV, or a Garmin .zip.',
        empty: 'No GPS track points found in that file.',
        parse_error: 'Could not read that file.',
      }
      return NextResponse.json({ error: msg[parsed.reason] ?? parsed.reason }, { status: 422 })
    }
    track = parsed.track
    source = { type: 'file', filename: file.name }
  } else if (stravaId) {
    const tokens = await getValidStravaTokens(userId)
    if (!tokens) return NextResponse.json({ error: 'Connect Strava first (Account → Strava).' }, { status: 400 })
    // A Strava API failure (rate limit, 5xx, network) is an expected, transient
    // condition — surface it as a retryable message, not a 500.
    let streams: Awaited<ReturnType<typeof getActivityStreams>>
    try {
      streams = await getActivityStreams(tokens.accessToken, stravaId)
    } catch (err) {
      console.error('[analyse] strava streams fetch failed', err)
      return NextResponse.json({ error: 'Could not reach Strava right now — please try again.' }, { status: 502 })
    }
    if (!streams) return NextResponse.json({ error: 'Could not read that Strava activity (no GPS stream).' }, { status: 422 })
    track = streamsToTrack(streams.latlng, streams.time, streams.startDate)
    const st = form.get('sportType')
    source = { type: 'strava', stravaActivityId: stravaId, sport: typeof st === 'string' && st ? st : undefined }
  } else {
    return NextResponse.json({ error: 'Provide a file or a Strava activity.' }, { status: 400 })
  }
  if (track.length < 2) return NextResponse.json({ error: 'Not enough GPS points to analyse.' }, { status: 422 })

  // Shared pipeline: conditions → analysis → duplicate detection → memory-aware
  // LLM narrative → save. The profile-refresh follow-up runs via `after()` so it
  // stays off the response's critical path.
  const { session, duplicate } = await analyseAndSave(userId, track, source, { schedule: after })
  return NextResponse.json({
    ...session.result, id: session.id, note: session.note,
    source: session.source, paddledAt: session.paddledAt,
    ...(duplicate ? { duplicate: true } : {}),
  })
}
