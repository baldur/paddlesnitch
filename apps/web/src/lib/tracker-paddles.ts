import { after } from 'next/server'
import { paddleForRecording } from '@paddlesnitch/analysis/tracker-paddle'
import { recordingReport } from '@/lib/recording-report'

// Make or update a tracker recording's paddle after the response has gone
// (docs/features/one-paddle.md, phase 2): the tracker, or the phone relaying
// over Bluetooth, shouldn't wait on the weather lookup and the written summary.
// The athlete-profile refresh runs inside the same job.
export function makePaddleAfterResponse(userId: string, deviceId: string, deviceSessionId: string): void {
  const job = async () => {
    try {
      const r = await paddleForRecording(userId, deviceId, deviceSessionId)
      // Work out the recording's report now, so BOAT MOTION's first view is
      // instant too (docs/features/performance.md, phase 1). Best effort.
      await recordingReport(userId, deviceId, deviceSessionId).catch(err => console.error('[recording-report] warm failed', err))
      console.log(`[tracker-paddle] ${deviceId}/${deviceSessionId}: ${r.status}${'paddleId' in r ? ` ${r.paddleId}` : ` (${r.reason})`}`)
    } catch (err) {
      console.error(`[tracker-paddle] ${deviceId}/${deviceSessionId} failed`, err)
    }
  }
  try {
    after(job)
  } catch {
    // Outside a request (scripts, and the upload tests that don't mock after):
    // no paddle from here. tracker-paddles.test.ts captures after() to test it.
  }
}
