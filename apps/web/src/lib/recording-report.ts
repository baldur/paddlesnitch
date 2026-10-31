import { derived, derivedKey, type DerivedSpec } from '@paddlesnitch/core/derived'
import { getDeviceSessionMeta, getDeviceSessionTrace, getDeviceSessionMotion, type DeviceSessionMeta } from '@paddlesnitch/core/devices'
import { describeDeviceData, noPaddleReason, noPaddleMessage, type DeviceDataReport } from '@paddlesnitch/timing/device'
import { MIN_PADDLE_METRES } from '@paddlesnitch/analysis/tracker-paddle'
import { recordingStrokeRate, STROKE_RATE_VERSION, type CadenceReport, type PaddlingFromMotion } from '@paddlesnitch/timing/cadence'
import { deriveAttitude, attitudeRangesFor, type AttitudeReport } from '@paddlesnitch/timing/attitude'

export type RecordingReport = {
  report: DeviceDataReport; cadence: CadenceReport | null; attitude: AttitudeReport | null
  /** Why it isn't a paddle, in plain words (GPS lost, no GPS, too short), or null. */
  noPaddle: string | null
  /** When the GPS failed: what the motion data says about the paddle (#414), in plain words, or null. */
  fromMotion: string | null
}

/**
 * A tracker recording's report (diagnostics, stroke rate, boat motion), for
 * BOAT MOTION and the tracker's page. Worked out once per recording version
 * (docs/features/performance.md, phase 1): it read the whole track and motion
 * file (2.2 MB for an hour) and recomputed everything on every view.
 *
 * Owner-checked: someone else's recording is null. The version is the
 * recording's upload time and its motion file's, so a motion file landing
 * after the track gives a new report, and so does a new recorder core (its
 * stroke rate can change).
 */
const spec = (userId: string, meta: DeviceSessionMeta): DerivedSpec => ({
  name: 'recording-report',
  owner: userId,
  inputs: [meta.deviceId, meta.sessionId, meta.uploadedAt, meta.motion?.uploadedAt ?? null, meta.motion?.bytes ?? null, STROKE_RATE_VERSION],
})

/**
 * The report's version, for an ETag: it changes exactly when the report does.
 * Null for someone else's recording.
 */
export async function recordingReportVersion(userId: string, deviceId: string, sessionId: string): Promise<string | null> {
  const meta = await getDeviceSessionMeta(userId, deviceId, sessionId)
  return meta ? derivedKey(spec(userId, meta)).split('/').pop()!.replace('.json', '') : null
}

export async function recordingReport(userId: string, deviceId: string, sessionId: string): Promise<RecordingReport | null> {
  const meta = await getDeviceSessionMeta(userId, deviceId, sessionId)
  if (!meta) return null
  return derived(spec(userId, meta), async () => {
    const trace = await getDeviceSessionTrace(userId, deviceId, sessionId)
    const csv = trace?.toString('utf8') ?? ''
    const report = describeDeviceData(csv)
    // Best effort, as before: a missing or unreadable motion file leaves the
    // report without stroke rate and boat motion rather than failing it.
    const why = noPaddleReason(csv, MIN_PADDLE_METRES)
    const gpsFailed = why?.kind === 'gps_lost' || why?.kind === 'no_gps'
    let cadence: CadenceReport | null = null
    let attitude: AttitudeReport | null = null
    let fromMotion: PaddlingFromMotion | null = null
    try {
      const motion = await getDeviceSessionMotion(userId, deviceId, sessionId)
      if (motion) {
        const text = motion.toString('utf8')
        // Where the GPS saw the boat moving; the whole recording when it failed.
        const strokes = recordingStrokeRate(csv, text)[gpsFailed ? 'all' : 'moving']
        cadence = strokes.report
        fromMotion = gpsFailed ? strokes.paddling : null
        attitude = deriveAttitude(text, { movingRanges: attitudeRangesFor(csv, gpsFailed) })
      }
    } catch { cadence = null; attitude = null; fromMotion = null }
    return {
      report, cadence, attitude,
      noPaddle: why ? noPaddleMessage(why, !!meta.motion) : null,
      fromMotion: fromMotion ? motionMessage(fromMotion) : null,
    }
  })
}

const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`)

/** "From the motion data: about 1 h 41 min paddling, about 5,200 strokes at 52 spm." */
export function motionMessage(m: { paddlingS: number; strokes: number; strokesPerMin: number }): string {
  const strokes = m.strokes >= 1000 ? Math.round(m.strokes / 100) * 100 : m.strokes
  return `From the motion data: about ${hm(m.paddlingS)} paddling, about ${strokes.toLocaleString('en-GB')} strokes at ${Math.round(m.strokesPerMin)} spm.`
}

