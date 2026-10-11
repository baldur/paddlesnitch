import { enqueueJob } from '@/lib/jobs'

// Make or update a tracker recording's paddle (docs/features/one-paddle.md,
// phase 2), as a job (lib/jobs.ts, #413): the tracker gets its answer as soon
// as the job is written, instead of waiting while the paddle is made.
export async function makePaddleAfterResponse(userId: string, deviceId: string, deviceSessionId: string): Promise<void> {
  await enqueueJob('tracker-paddle', { userId, deviceId, deviceSessionId })
}
