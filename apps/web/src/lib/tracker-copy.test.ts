import { describe, it, expect } from 'vitest'
import { strokeRateCopy, gpsCopy, noMotionCopy } from './tracker-copy'
import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

const report = (over: Partial<DeviceDataReport> = {}): DeviceDataReport => ({
  hasImu: true,
  strokeRate: { available: false, reason: 'Not derivable: this firmware logs a per-second accelerometer peak at 1 Hz…', evidence: null },
  capture: { gaps: 0, missingRows: 0, capturedFraction: 1, intervalS: 1, longestGapS: 0 },
  gnss: { fixTrend: 'steady' },
  ...over,
} as unknown as DeviceDataReport)
const cadence = (available: boolean): CadenceReport =>
  ({ available, reason: available ? '' : 'No window showed a clear repeating stroke pattern', medianStrokesPerMin: available ? 58 : null } as unknown as CadenceReport)

// The old text was addressed to a firmware developer.
const JARGON = /derivable|firmware|sidecar|\bHz\b|accelerometer|cadence|column/i

describe('strokeRateCopy', () => {
  it('shows the measured rate when the motion data gave one', () => {
    expect(strokeRateCopy(report(), cadence(true))).toEqual({ spm: 58, text: 'Measured from the tracker’s motion data.' })
  })
  it('says motion data comes later when it has not arrived yet', () => {
    expect(strokeRateCopy(report(), null).text).toMatch(/uploads after the GPS track/)
  })
  it('says the stroke wasn\'t steady when motion data gave nothing', () => {
    expect(strokeRateCopy(report(), cadence(false)).text).toMatch(/couldn’t find a steady stroke/)
  })
  it('says the file carried it when it did', () => {
    expect(strokeRateCopy(report({ strokeRate: { available: true, reason: 'x', evidence: null } }), null).text).toBe('Stroke rate came from the file.')
  })
  it('never uses engineering words', () => {
    for (const c of [cadence(true), cadence(false), null]) {
      for (const r of [report(), report({ hasImu: false })]) expect(strokeRateCopy(r, c).text).not.toMatch(JARGON)
    }
  })
})

describe('gpsCopy', () => {
  it('says nothing when GPS was steady with no gaps', () => {
    expect(gpsCopy(report())).toBeNull()
  })
  it('explains a slow start and gaps plainly', () => {
    const r = report({ gnss: { fixTrend: 'improving' } as never, capture: { gaps: 3 } as never })
    expect(gpsCopy(r)).toBe('GPS was less accurate for the first few minutes. 3 gaps in the recording.')
  })
})

describe('noMotionCopy', () => {
  it('tells apart "not uploaded yet" from "uploaded but unreadable"', () => {
    expect(noMotionCopy(null)).toMatch(/sync the tracker again/)
    expect(noMotionCopy({ available: false, reason: 'No usable gravity reference' } as AttitudeReport)).toMatch(/fixed firmly/)
    expect(noMotionCopy(null)).not.toMatch(JARGON)
  })
})
