import { NextRequest, NextResponse, after } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { getActivityStreams, streamsToTrack } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { getWeatherAt } from '@paddlesnitch/timing/weather'
import { getFlowAt } from '@paddlesnitch/timing/river-flow'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import { generateInsight, type InsightContext } from '@paddlesnitch/analysis/llm'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant, type PaddleFacts } from '@paddlesnitch/analysis/history-stats'
import { refreshAthleteProfile } from '@paddlesnitch/analysis/athlete-profile'
import { saveSession, listSessionSummaries, getSession, getAthleteProfile, paddleFingerprint, type AnalysisSession, type AnalysisSource, type SessionSummary } from '@paddlesnitch/analysis/analysis-store'
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

// Resolve a best-effort promise to null on either rejection or a deadline, so a
// slow external dependency can never hang the request.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
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

  const mid = track[Math.floor(track.length / 2)]
  const when = track[0].timestamp.toISOString()

  // best-effort real conditions — bounded so a slow/hanging external API
  // (Open-Meteo / EA) can't stall the analysis toward the Lambda timeout. The
  // plain fetches inside these have no timeout of their own, so wrap them: on
  // error OR timeout we proceed with no conditions. Both run in parallel.
  const [weather, flow] = await Promise.all([
    withDeadline(getWeatherAt(mid.lat, mid.lng, when), 4000),
    withDeadline(getFlowAt(mid.lat, mid.lng, when), 4000),
  ])
  const conditions = {
    windKmh: weather?.windSpeedKmh, windDir: weather?.windDirectionDeg,
    flowM3s: flow?.valueM3s, flowStation: flow?.stationLabel,
  }

  // Default to NOT doubling stroke rate — the paddler can turn on the SUP→kayak
  // ×2 in the view if their device under-counts. (source.sport is kept as
  // metadata but no longer forces doubling.)
  const result = analyseTrack(track, { doubleStrokeRate: false, conditions })

  // Read the user's library ONCE and reuse it for both duplicate detection and
  // the memory context below. Reading it twice (as this route used to) doubled
  // the S3 work on the critical path — every session's full record, including its
  // track points — and, as a library grew, that crept toward the Lambda timeout
  // and surfaced to the paddler as "analysis failed". Best-effort: a read failure
  // degrades to a fresh, no-context analysis, never a 500.
  let prior: SessionSummary[] = []
  try { prior = await listSessionSummaries(userId) }
  catch (err) { console.error('[analyse] history read failed', err) }

  // Duplicate detection (#178): if this exact paddle is already saved, return the
  // existing one (skipping the LLM call + save) so the client can jump to it.
  const fp = paddleFingerprint(when, result.durationS, result.distanceKm)
  const dup = prior.find(s => paddleFingerprint(s.paddledAt, s.durationS, s.distanceKm) === fp)
  if (dup) {
    try {
      const existing = await getSession(userId, dup.id)
      if (existing) return NextResponse.json({
        ...existing.result, id: existing.id, note: existing.note,
        source: existing.source, paddledAt: existing.paddledAt, duplicate: true,
      })
    } catch (err) { console.error('[analyse] duplicate fetch failed', err) }
  }

  const now = new Date()

  // Memory-aware narrative (docs/features/personable-insights.md). The paddler's
  // PRIOR paddles drive three context layers (L1 aggregates, L3 relevant paddles,
  // L2 profile), all fed to the model as compact text — grounded facts only.
  // WRAPPED so the enrichment can NEVER fail the analysis: any read/compute error
  // degrades to a plain (no-context) insight rather than 500-ing the request.
  // Seeded with the paddle date + sport so the model never assumes an import is
  // today and uses sport-appropriate language.
  const sportSignal = source.type === 'strava' ? source.sport : undefined
  let ctx: InsightContext = { paddledAt: when, asOf: now.toISOString(), sport: sportSignal }
  try {
    const profile = await getAthleteProfile(userId)
    const currentFacts: PaddleFacts = {
      paddledAt: when, cruiseSpeed: result.cruiseSpeed, distanceKm: result.distanceKm,
      avgSR: result.avgSR, avgDps: result.avgDps,
      startLat: result.points[0]?.lat, startLng: result.points[0]?.lng,
    }
    ctx = {
      ...ctx,
      profile: profile?.text,
      historyFacts: renderHistoryFacts(computeHistoryStats(currentFacts, prior, now)),
      relevant: renderRelevant(selectRelevantPaddles(currentFacts, prior)),
    }
  } catch (err) { console.error('[analyse] memory context failed', err) }

  const narrated = await generateInsight(result, ctx)
  if (narrated) { result.insight = narrated; result.insightModel = process.env.LLM_MODEL || '' }

  // auto-save to the user's library
  const session: AnalysisSession = {
    id: nanoid(), userId, createdAt: now.toISOString(), paddledAt: when,
    source, doubleStrokeRate: false, note: '', insight: result.insight, result,
  }
  await saveSession(session)

  // Fold this paddle into the persistent athlete profile for NEXT time — a SECOND
  // LLM call. Kept OFF the response's critical path via after(): it runs once the
  // response has flushed (Lambda stays alive for it), so it can neither slow the
  // analysis nor push the request past the 30s Lambda timeout. Best-effort.
  after(async () => {
    try {
      const all = await listSessionSummaries(userId)
      const latest = all.find(s => s.id === session.id)
      if (latest) await refreshAthleteProfile(userId, latest, all, new Date().toISOString())
    } catch (err) { console.error('[analyse] profile refresh failed', err) }
  })

  return NextResponse.json({ ...result, id: session.id, note: '', source, paddledAt: when })
}
