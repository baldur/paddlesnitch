// The shared "analyse a resolved track and save it to the library" core, used by
// BOTH the manual analyse route (file / Strava / trial / device) and the Strava
// auto-import webhook. It owns everything after the track is resolved: real
// conditions, the deterministic analysis, duplicate detection, the memory-aware
// LLM narrative, and the save — plus the follow-up athlete-profile refresh.
//
// Framework-agnostic: the profile refresh is a second LLM call kept off the
// caller's critical path, so the caller passes a `schedule` (e.g. Next's
// `after`); with no scheduler it just awaits inline (webhook / tests).
import { nanoid } from 'nanoid'
import { getWeatherAt } from '@paddlesnitch/timing/weather'
import { getFlowAt } from '@paddlesnitch/timing/river-flow'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { analyseTrack } from './analysis'
import { generateInsight, type InsightContext } from './llm'
import { computeHistoryStats, renderHistoryFacts, selectRelevantPaddles, renderRelevant, type PaddleFacts } from './history-stats'
import { refreshAthleteProfile } from './athlete-profile'
import {
  saveSession, listSessionSummaries, getSession, getAthleteProfile, paddleFingerprint,
  type AnalysisSession, type AnalysisSource, type SessionSummary,
} from './analysis-store'

// Resolve a best-effort promise to null on rejection or a deadline, so a slow
// external dependency (Open-Meteo / EA — no fetch timeout of their own) can never
// stall the analysis toward the Lambda timeout.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
}

export type AnalyseSaveResult = { session: AnalysisSession; duplicate: boolean }

// Analyse `track` for `userId`, save it as a paddle, and return the saved (or
// pre-existing duplicate) session. Every enrichment step degrades on its own —
// conditions, history/memory, and the LLM can each fail without failing the save.
export async function analyseAndSave(
  userId: string,
  track: TrackPoint[],
  source: AnalysisSource,
  opts: { now?: Date; sport?: string; schedule?: (fn: () => void | Promise<void>) => void } = {},
): Promise<AnalyseSaveResult> {
  const now = opts.now ?? new Date()
  const mid = track[Math.floor(track.length / 2)]
  const when = track[0].timestamp.toISOString()

  // best-effort real conditions, bounded so a slow external API can't hang us.
  const [weather, flow] = await Promise.all([
    withDeadline(getWeatherAt(mid.lat, mid.lng, when), 4000),
    withDeadline(getFlowAt(mid.lat, mid.lng, when), 4000),
  ])
  const conditions = {
    windKmh: weather?.windSpeedKmh, windDir: weather?.windDirectionDeg,
    flowM3s: flow?.valueM3s, flowStation: flow?.stationLabel,
  }

  const result = analyseTrack(track, { doubleStrokeRate: false, conditions })

  // Read the library ONCE; reuse for both duplicate detection and memory context.
  let prior: SessionSummary[] = []
  try { prior = await listSessionSummaries(userId) }
  catch (err) { console.error('[analyse] history read failed', err) }

  // Duplicate detection (#178): return the existing paddle instead of a 2nd copy.
  const fp = paddleFingerprint(when, result.durationS, result.distanceKm)
  const dup = prior.find(s => paddleFingerprint(s.paddledAt, s.durationS, s.distanceKm) === fp)
  if (dup) {
    const existing = await getSession(userId, dup.id).catch(() => null)
    if (existing) return { session: existing, duplicate: true }
  }

  // Memory-aware narrative (docs/features/personable-insights.md) — grounded facts
  // only, and wrapped so any read/compute error degrades to a plain insight.
  const sportSignal = opts.sport ?? (source.type === 'strava' ? source.sport : undefined)
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

  const session: AnalysisSession = {
    id: nanoid(), userId, createdAt: now.toISOString(), paddledAt: when,
    source, doubleStrokeRate: false, note: '', insight: result.insight, result,
  }
  await saveSession(session)

  // Fold this paddle into the persistent athlete profile for NEXT time (a 2nd LLM
  // call). Off the critical path when a scheduler is given; awaited otherwise.
  const refresh = async () => {
    try {
      const all = await listSessionSummaries(userId)
      const latest = all.find(s => s.id === session.id)
      if (latest) await refreshAthleteProfile(userId, latest, all, new Date().toISOString())
    } catch (err) { console.error('[analyse] profile refresh failed', err) }
  }
  if (opts.schedule) opts.schedule(refresh); else await refresh()

  return { session, duplicate: false }
}
