import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// What the tracker pages say, in plain words. The diagnostics in
// @paddlesnitch/timing explain themselves to an engineer ("Not derivable: this
// firmware logs a per-second accelerometer peak at 1 Hz…"); a paddler needs
// the answer and, if there is one, what to do. The engineering reasons still
// show under TECHNICAL DETAILS.

export type StrokeRateCopy = { spm: number | null; text: string }

export function strokeRateCopy(report: DeviceDataReport, cadence: CadenceReport | null): StrokeRateCopy {
  if (cadence?.available) return { spm: cadence.medianStrokesPerMin, text: 'Measured from the tracker’s motion data.' }
  if (report.strokeRate.available) return { spm: null, text: 'Stroke rate came from the file.' }
  if (cadence && !cadence.available) {
    return { spm: null, text: 'The motion data arrived, but we couldn’t find a steady stroke in it. The tracker may not have been fixed in the boat.' }
  }
  if (report.hasImu) {
    return { spm: null, text: 'Stroke rate comes from the tracker’s motion data, which uploads after the GPS track. If this recording is recent, sync the tracker again.' }
  }
  return { spm: null, text: 'No stroke rate: this recording has no motion data.' }
}

// One line about GPS quality, or null when there's nothing worth saying.
export function gpsCopy(report: DeviceDataReport): string | null {
  const gaps = report.capture.gaps
  const trend = report.gnss.fixTrend
  const parts: string[] = []
  if (trend === 'improving') parts.push('GPS was less accurate for the first few minutes.')
  if (trend === 'degrading') parts.push('GPS got worse during the recording. Check the tracker has a clear view of the sky.')
  if (gaps > 0) parts.push(`${gaps === 1 ? 'One gap' : `${gaps} gaps`} in the recording.`)
  return parts.length ? parts.join(' ') : null
}

// Why there are no boat-motion charts.
export function noMotionCopy(attitude: AttitudeReport | null): string {
  // A reason means motion data WAS uploaded but yielded nothing; none means it
  // hasn't arrived (a recent recording still on the tracker, or one from before
  // the tracker recorded motion). Don't tell someone this morning's paddle
  // "never will" have it.
  return attitude?.reason
    ? 'We couldn’t measure boat motion in this recording. The tracker may not have been fixed firmly in the boat.'
    : 'Motion data uploads after the GPS track. If this recording is recent, sync the tracker again. Older recordings have no motion data.'
}
