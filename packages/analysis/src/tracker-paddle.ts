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
import { getDeviceSessionMotion } from '@paddlesnitch/core/devices'
import { loadDeviceSessionTrack } from './device-sessions'
import { analyseAndSave, reanalyseAndSave } from './pipeline'
import { getSession, listSessionSummaries, type AnalysisSession } from './analysis-store'
import type { TrackPoint } from '@paddlesnitch/timing/types'
import { movementDistanceM } from '@paddlesnitch/timing/device'

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
  | { action: 'update'; track: TrackPoint[]; existing: AnalysisSession }
  | { action: 'unchanged'; paddleId: string }
  | { action: 'skip'; reason: 'no_track' | 'too_short' }

export async function planForRecording(userId: string, deviceId: string, deviceSessionId: string): Promise<TrackerPaddlePlan> {
  // Checked BEFORE the track is read: if the motion data was there already, the
  // track below has used it, whether or not it gave a stroke rate.
  const hadMotion = !!(await getDeviceSessionMotion(userId, deviceId, deviceSessionId).catch(() => null))
  const track = await loadDeviceSessionTrack(userId, deviceId, deviceSessionId)
  // No usable GPS (an indoor test, a bench log): not a paddle.
  if (!track) return { action: 'skip', reason: 'no_track' }
  const hasStrokeRate = track.some(p => p.strokeRate != null)

  // Its paddle, if it has one: made by hand before this existed (any id), or
  // by an earlier call (the fixed id).
  const summaries = await listSessionSummaries(userId)
  const known = summaries.find(s => s.source.type === 'device' && s.source.deviceSessionId === deviceSessionId)
  const existing = await getSession(userId, known?.id ?? trackerPaddleId(deviceSessionId)).catch(() => null)
  if (!existing) {
    // A desk test, a bench log, a tracker switched on in the car: the boat
    // didn't go anywhere. Measured on every recording so far: real paddles
    // moved 1.6 km or more, the rest 154 m at most.
    const moved = movementDistanceM(track.map(p => ({ lat: p.lat, lng: p.lng, tMs: p.timestamp.getTime() })))
    if (moved < MIN_PADDLE_METRES) return { action: 'skip', reason: 'too_short' }
    return { action: 'create', track, hasStrokeRate, hadMotion }
  }
  // Only the motion data adds anything (stroke rate); otherwise leave the
  // paddle, its summary and the paddler's edits exactly as they are.
  if (!hasStrokeRate || existing.result.avgSR != null) return { action: 'unchanged', paddleId: existing.id }
  return { action: 'update', track, existing }
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
