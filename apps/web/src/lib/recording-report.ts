import { derived, derivedKey, type DerivedSpec } from '@paddlesnitch/core/derived'
import { getDeviceSessionMeta, getDeviceSessionTrace, getDeviceSessionMotion, type DeviceSessionMeta } from '@paddlesnitch/core/devices'
import { describeDeviceData, type DeviceDataReport } from '@paddlesnitch/timing/device'
import { deriveCadence, movingRangesFromTrack, type CadenceReport } from '@paddlesnitch/timing/cadence'
import { deriveAttitude, type AttitudeReport } from '@paddlesnitch/timing/attitude'

export type RecordingReport = { report: DeviceDataReport; cadence: CadenceReport | null; attitude: AttitudeReport | null }

/**
 * A tracker recording's report (diagnostics, stroke rate, boat motion), for
 * BOAT MOTION and the tracker's page. Worked out once per recording version
 * (docs/features/performance.md, phase 1): it read the whole track and motion
 * file (2.2 MB for an hour) and recomputed everything on every view.
 *
 * Owner-checked: someone else's recording is null. The version is the
 * recording's upload time and its motion file's, so a motion file landing
 * after the track gives a new report.
 */
const spec = (userId: string, meta: DeviceSessionMeta): DerivedSpec => ({
  name: 'recording-report',
  owner: userId,
  inputs: [meta.deviceId, meta.sessionId, meta.uploadedAt, meta.motion?.uploadedAt ?? null, meta.motion?.bytes ?? null],
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
    let cadence: CadenceReport | null = null
    let attitude: AttitudeReport | null = null
    try {
      const motion = await getDeviceSessionMotion(userId, deviceId, sessionId)
      if (motion) {
        const text = motion.toString('utf8')
        const movingRanges = movingRangesFromTrack(csv)
        cadence = deriveCadence(text, { movingRanges })
        attitude = deriveAttitude(text, { movingRanges })
      }
    } catch { cadence = null; attitude = null }
    return { report, cadence, attitude }
  })
}
