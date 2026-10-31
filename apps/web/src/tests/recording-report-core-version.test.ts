// A recording's report is worked out once per version (recording-report.ts),
// and its stroke rate comes from the recorder core. A new core can change the
// numbers, so the report's version must change with it, or the site would
// keep showing the old core's stroke rate (phase 2b moved every rate).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const core = vi.hoisted(() => ({ version: '0.3.0+aaaaaaaaaaaa' }))
vi.mock('@paddlesnitch/timing/cadence', async importOriginal => ({
  ...(await importOriginal<typeof import('@paddlesnitch/timing/cadence')>()),
  get STROKE_RATE_VERSION() { return core.version },
}))

import { storeDeviceSession } from '@paddlesnitch/core/devices'
import { recordingReportVersion } from '@/lib/recording-report'
import { makeDataDir, cleanDataDir } from './helpers'
import { trackCsv } from './tracker-fixtures'

describe("a recording report's version", () => {
  let dir: string
  beforeEach(async () => { dir = await makeDataDir() })
  afterEach(async () => { await cleanDataDir(dir) })

  it('changes when the recorder core does, and only then', async () => {
    const { sessionId } = await storeDeviceSession({ deviceId: 'AABBCCDD', userId: 'u1', filename: 'track_1.csv', points: 60 }, trackCsv(60, 9))
    const before = await recordingReportVersion('u1', 'AABBCCDD', sessionId)
    expect(await recordingReportVersion('u1', 'AABBCCDD', sessionId)).toBe(before)
    core.version = '0.3.0+bbbbbbbbbbbb'
    expect(await recordingReportVersion('u1', 'AABBCCDD', sessionId)).not.toBe(before)
  })
})
