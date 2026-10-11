// A tracker recording becomes a paddle by itself (docs/features/one-paddle.md,
// phase 2). Called after a recording's track is accepted, and again after its
// motion data lands (that's what adds the stroke rate), from either upload
// route: the tracker's own over WiFi, or the owner's browser over Bluetooth.
//
// The two calls can run at the same moment (a short recording's motion file
// follows its track within a second), so:
//  - a recording's paddle has a FIXED id, so both write the same paddle and a
//    race can never make two;
//  - the GPS-only call doesn't save if the motion data has landed meanwhile,
//    so it can't overwrite the fuller paddle the other call is making.
//
// A recording whose GPS failed (lost the sky, or never found it) becomes a
// paddle without a map (#414) when its motion data shows at least 10 minutes
// of paddling: made by the call after the motion data lands.
import { getDeviceSessionMotion, getDeviceSessionTrace } from '@paddlesnitch/core/devices'
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { loadDeviceSessionTrack } from './device-sessions'
import { analyseAndSave, reanalyseAndSave } from './pipeline'
import { getSession, listSessionSummaries, saveSession, type AnalysisSession } from './analysis-store'
import { motionOnlyResult, type AnalysisResult } from './analysis'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { movementDistanceM, noPaddleReason, recordingStart } from '@paddlesnitch/timing/device'
import { deriveCadence, movingRangesFromTrack, trackClockOffset } from '@paddlesnitch/timing/cadence'

export type TrackerPaddleOutcome =
  | { status: 'created' | 'updated'; paddleId: string }
  | { status: 'unchanged'; paddleId: string }
  | { status: 'skipped'; reason: 'no_track' | 'too_short' | 'superseded' }

/** How far the boat must move for a recording to become a paddle by itself. */
export const MIN_PADDLE_METRES = 500

/** The paddle id for a recording that didn't already have one. */
export const trackerPaddleId = (deviceSessionId: string) => `t-${deviceSessionId}`

/** Each tracker recording's paddle id, from the user's paddle summaries. */
export function paddleIdsByRecording(summaries: { id: string; source: { type: string; deviceSessionId?: string } }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of summaries) if (s.source.type === 'device' && s.source.deviceSessionId) out[s.source.deviceSessionId] = s.id
  return out
}

/** What `paddleForRecording` would do for a recording, without doing it. */
export type TrackerPaddlePlan =
  | { action: 'create'; track: TrackPoint[]; hasStrokeRate: boolean; hadMotion: boolean }
  | { action: 'create_motion'; result: AnalysisResult; paddledAt: string }
  | { action: 'update'; track: TrackPoint[]; existing: AnalysisSession }
  | { action: 'unchanged'; paddleId: string }
  | { action: 'skip'; reason: 'no_track' | 'too_short' }

// Its paddle, if it has one: made by hand before this existed (any id), or
// by an earlier call (the fixed id).
async function existingPaddle(userId: string, deviceSessionId: string): Promise<AnalysisSession | null> {
  const summaries = await listSessionSummaries(userId)
  const known = summaries.find(s => s.source.type === 'device' && s.source.deviceSessionId === deviceSessionId)
  return getSession(userId, known?.id ?? trackerPaddleId(deviceSessionId)).catch(() => null)
}

export async function planForRecording(userId: string, deviceId: string, deviceSessionId: string): Promise<TrackerPaddlePlan> {
  // Checked BEFORE the track is read: if the motion data was there already, the
  // track below has used it, whether or not it gave a stroke rate.
  const hadMotion = !!(await getDeviceSessionMotion(userId, deviceId, deviceSessionId).catch(() => null))
  const track = await loadDeviceSessionTrack(userId, deviceId, deviceSessionId)
  // No usable GPS (an indoor test, a bench log): not a paddle, unless the GPS
  // failed on a paddle the motion data shows.
  if (!track) return (await motionPlan(userId, deviceId, deviceSessionId, null)) ?? { action: 'skip', reason: 'no_track' }
  const hasStrokeRate = track.some(p => p.strokeRate != null)

  const existing = await existingPaddle(userId, deviceSessionId)
  if (!existing) {
    // A desk test, a bench log, a tracker switched on in the car: the boat
    // didn't go anywhere. Measured on every recording so far: real paddles
    // moved 1.6 km or more, the rest 154 m at most. Or the GPS lost the sky
    // soon after setting off, and the motion data shows the paddle.
    const moved = movementDistanceM(track.map(p => ({ lat: p.lat, lng: p.lng, tMs: p.timestamp.getTime() })))
    if (moved < MIN_PADDLE_METRES) return (await motionPlan(userId, deviceId, deviceSessionId, track)) ?? { action: 'skip', reason: 'too_short' }
    return { action: 'create', track, hasStrokeRate, hadMotion }
  }
  // A paddle without a map has everything the motion data gives already.
  if (isMotionOnly(existing.result)) return { action: 'unchanged', paddleId: existing.id }
  // Only the motion data adds anything (stroke rate); otherwise leave the
  // paddle, its summary and the paddler's edits exactly as they are.
  if (!hasStrokeRate || existing.result.avgSR != null) return { action: 'unchanged', paddleId: existing.id }
  return { action: 'update', track, existing }
}

/**
 * A paddle without a map (#414), when the recording's GPS failed and its
 * motion data shows at least 10 minutes of paddling; null otherwise (no
 * motion data yet, a desk test, too little paddling). `track`: the GPS
 * recorded before it was lost, if any.
 */
async function motionPlan(userId: string, deviceId: string, deviceSessionId: string, track: TrackPoint[] | null): Promise<TrackerPaddlePlan | null> {
  const [trace, motion] = await Promise.all([
    getDeviceSessionTrace(userId, deviceId, deviceSessionId),
    getDeviceSessionMotion(userId, deviceId, deviceSessionId).catch(() => null),
  ])
  if (!trace || !motion) return null
  const csv = trace.toString('utf8')
  const reason = noPaddleReason(csv, MIN_PADDLE_METRES)
  const start = recordingStart(csv)
  if (!reason || reason.kind === 'too_short' || !start) return null
  const existing = await existingPaddle(userId, deviceSessionId)
  if (existing) return { action: 'unchanged', paddleId: existing.id }
  // The cadence as the recording's page works it out (recording-report.ts),
  // so the paddle and the page agree.
  let result: AnalysisResult | null
  try {
    const cadence = deriveCadence(motion.toString('utf8'), { movingRanges: movingRangesFromTrack(csv) })
    result = motionOnlyResult({ reason, cadence, startMs: Date.parse(start), clockOffsetMs: trackClockOffset(csv), track })
  } catch { return null }
  return result && { action: 'create_motion', result, paddledAt: start }
}

export async function paddleForRecording(
  userId: string, deviceId: string, deviceSessionId: string,
): Promise<TrackerPaddleOutcome> {
  const plan = await planForRecording(userId, deviceId, deviceSessionId)
  switch (plan.action) {
    case 'skip': return { status: 'skipped', reason: plan.reason }
    case 'unchanged': return { status: 'unchanged', paddleId: plan.paddleId }
    case 'update':
      await reanalyseAndSave(userId, plan.existing, plan.track)
      return { status: 'updated', paddleId: plan.existing.id }
    case 'create_motion': {
      // Saved with the plain summary; the paddle page asks for the written
      // one, as for any paddle (pipeline.ts, writePendingSummary).
      const id = trackerPaddleId(deviceSessionId)
      await saveSession({
        id, userId, createdAt: new Date().toISOString(), paddledAt: plan.paddledAt,
        source: { type: 'device', deviceId, deviceSessionId }, doubleStrokeRate: false, note: '',
        insight: plan.result.insight, result: plan.result, insightPending: true,
      })
      return { status: 'created', paddleId: id }
    }
  }
  const r = await analyseAndSave(userId, plan.track, { type: 'device', deviceId, deviceSessionId }, {
    id: trackerPaddleId(deviceSessionId),
    // The motion data landed while this GPS-only paddle was being written: the
    // call it triggered makes the fuller one. Only "landed meanwhile": motion
    // that was there from the start but gives no stroke rate (single-sided, too
    // short) must not stop the save, or that recording never gets a paddle.
    shouldSave: async () => plan.hasStrokeRate || plan.hadMotion ||
      !(await getDeviceSessionMotion(userId, deviceId, deviceSessionId).catch(() => null)),
  })
  if (r.dropped) return { status: 'skipped', reason: 'superseded' }
  // The same outing already added by hand from the same file (fingerprint).
  if (r.duplicate) return { status: 'unchanged', paddleId: r.session.id }
  return { status: 'created', paddleId: r.session.id }
}
