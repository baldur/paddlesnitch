import { NextRequest, NextResponse, after } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { getActivityStreams, streamsToTrack } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { getWeatherAt } from '@paddlesnitch/timing/weather'
import { getFlowAt } from '@paddlesnitch/timing/river-flow'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseTrack } from '@/lib/analysis'
import { generateInsight } from '@/lib/llm'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant, type PaddleFacts } from '@/lib/history-stats'
import { refreshAthleteProfile } from '@/lib/athlete-profile'
import { saveSession, listSessionSummaries, getAthleteProfile, type AnalysisSession, type AnalysisSource } from '@/lib/analysis-store'
import { loadTrialEntryTrack, listUserTrialEntries } from '@/lib/trials'

// Analyse a paddle (file upload OR Strava activity), narrate it with the
// history-aware LLM, and SAVE it to the signed-in user's library. Auth-gated
// (personal diary/history) — which also means the LLM endpoint isn't public.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Sign in to analyse and save paddles.' }, { status: 401 })

  const form = await req.formData()

  // ---- resolve the track from a file or a Strava activity ----
  let track: TrackPoint[]
  let source: AnalysisSource
  const file = form.get('file')
  const stravaId = Number(form.get('stravaActivityId'))
  const trialEntryId = form.get('trialEntryId')
  const trialId = form.get('trialId')

  if (typeof trialEntryId === 'string' && trialEntryId && typeof trialId === 'string' && trialId) {
    const loaded = await loadTrialEntryTrack(user.id, trialId, trialEntryId)
    if (!loaded) return NextResponse.json({ error: 'Could not load that time-trial entry.' }, { status: 404 })
    track = loaded
    // Look up the entry's display info so the saved paddle names its course.
    const summary = (await listUserTrialEntries(user.id)).find(e => e.entryId === trialEntryId)
    source = { type: 'trial', trialId, entryId: trialEntryId, courseName: summary?.courseName, filename: summary?.filename }
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
    const tokens = await getValidStravaTokens(user.id)
    if (!tokens) return NextResponse.json({ error: 'Connect Strava first (Account → Strava).' }, { status: 400 })
    const streams = await getActivityStreams(tokens.accessToken, stravaId)
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

  // best-effort real conditions (never block the analysis)
  const [weather, flow] = await Promise.all([
    getWeatherAt(mid.lat, mid.lng, when).catch(() => null),
    getFlowAt(mid.lat, mid.lng, when).catch(() => null),
  ])
  const conditions = {
    windKmh: weather?.windSpeedKmh, windDir: weather?.windDirectionDeg,
    flowM3s: flow?.valueM3s, flowStation: flow?.stationLabel,
  }

  // Default to NOT doubling stroke rate — the paddler can turn on the SUP→kayak
  // ×2 in the view if their device under-counts. (source.sport is kept as
  // metadata but no longer forces doubling.)
  const result = analyseTrack(track, { doubleStrokeRate: false, conditions })

  const now = new Date()

  // Memory-aware narrative (docs/features/personable-insights.md). The paddler's
  // PRIOR paddles drive three context layers (L1 aggregates, L3 relevant paddles,
  // L2 profile), all fed to the model as compact text — grounded facts only.
  // WRAPPED so the enrichment can NEVER fail the analysis: any read/compute error
  // degrades to a plain (no-context) insight rather than 500-ing the request.
  let ctx: { profile?: string; historyFacts?: string; relevant?: string } = {}
  try {
    const prior = await listSessionSummaries(user.id)
    const profile = await getAthleteProfile(user.id)
    const currentFacts: PaddleFacts = {
      paddledAt: when, cruiseSpeed: result.cruiseSpeed, distanceKm: result.distanceKm,
      avgSR: result.avgSR, avgDps: result.avgDps,
      startLat: result.points[0]?.lat, startLng: result.points[0]?.lng,
    }
    ctx = {
      profile: profile?.text,
      historyFacts: renderHistoryFacts(computeHistoryStats(currentFacts, prior, now)),
      relevant: renderRelevant(selectRelevantPaddles(currentFacts, prior)),
    }
  } catch (err) { console.error('[analyse] memory context failed', err) }

  const narrated = await generateInsight(result, ctx)
  if (narrated) { result.insight = narrated; result.insightModel = process.env.LLM_MODEL || '' }

  // auto-save to the user's library
  const session: AnalysisSession = {
    id: nanoid(), userId: user.id, createdAt: now.toISOString(), paddledAt: when,
    source, doubleStrokeRate: false, note: '', insight: result.insight, result,
  }
  await saveSession(session)

  // Fold this paddle into the persistent athlete profile for NEXT time — a SECOND
  // LLM call. Kept OFF the response's critical path via after(): it runs once the
  // response has flushed (Lambda stays alive for it), so it can neither slow the
  // analysis nor push the request past the 30s Lambda timeout. Best-effort.
  after(async () => {
    try {
      const all = await listSessionSummaries(user.id)
      const latest = all.find(s => s.id === session.id)
      if (latest) await refreshAthleteProfile(user.id, latest, all, new Date().toISOString())
    } catch (err) { console.error('[analyse] profile refresh failed', err) }
  })

  return NextResponse.json({ ...result, id: session.id, note: '', source, paddledAt: when })
}
