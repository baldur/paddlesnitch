// Work done after answering (#413, owner's choice: the S3 to-do folder). On
// our Lambda, Next's after() runs BEFORE the response is sent, so a slow job
// (making a tracker recording's paddle) held the caller's request open.
//
// Instead the request writes a small job file and answers at once:
//
//   jobs/{kind}/{id}.json          the job: { kind, payload, createdAt, notBefore? }
//   jobs-state/{kind}/{id}.json    attempts so far (kept apart so writing it
//                                  doesn't count as a new job)
//   jobs-failed/{kind}/{id}.json   a job that failed MAX_ATTEMPTS times
//
// S3 notices the new file and starts the jobs kicker (infra/lambdas/jobs-kicker),
// which asks this server to run it (POST /api/jobs/run). The 5-minute timer
// starts the kicker too, to sweep up retries, leftovers and jobs not due yet
// (POST /api/jobs/sweep). A job deletes its file when done; the folder is the
// visible record of what's waiting or failed.
//
// Jobs must be safe to run twice: S3 can announce a file twice, and the sweep
// can meet a job the announcement is still running. The one kind here is
// (a tracker recording's paddle has a fixed id).
//
// Local dev has no S3 events, so a new job runs in this process straight away;
// tests run jobs themselves (runJob / sweepJobs).
import { nanoid } from 'nanoid'
import { getJson, putJson, listKeys, deleteObject } from '@/lib/storage'
import { paddleForRecording } from '@paddlesnitch/analysis/tracker-paddle'
import { recordingReport } from '@/lib/recording-report'

export const MAX_ATTEMPTS = 5
/** A job announced by S3 is usually running already; the sweep leaves it this long. */
const FRESH_MS = 60_000
/** A run that started this recently is still going (a Lambda gives up after 30 s). */
const LEASE_MS = 3 * 60_000
/** The sweep stops starting jobs after this, inside the server's 30 s limit. */
const SWEEP_BUDGET_MS = 20_000

type Handlers = {
  'tracker-paddle': { userId: string; deviceId: string; deviceSessionId: string }
}
export type JobKind = keyof Handlers
type Job<K extends JobKind = JobKind> = { kind: K; payload: Handlers[K]; createdAt: string; notBefore?: string }
type JobState = { attempts: number; runningSince?: string; retryAfter?: string; lastError?: string }

const HANDLERS: { [K in JobKind]: (p: Handlers[K]) => Promise<void> } = {
  // A tracker recording's paddle (one-paddle.md, phase 2), then its report so
  // BOAT MOTION's first view is instant (performance.md, phase 1).
  'tracker-paddle': async ({ userId, deviceId, deviceSessionId }) => {
    const r = await paddleForRecording(userId, deviceId, deviceSessionId)
    await recordingReport(userId, deviceId, deviceSessionId).catch(err => console.error('[recording-report] warm failed', err))
    console.log(`[tracker-paddle] ${deviceId}/${deviceSessionId}: ${r.status}${'paddleId' in r ? ` ${r.paddleId}` : ` (${r.reason})`}`)
  },
}

const KEY = /^jobs\/(tracker-paddle)\/[\w-]{1,40}\.json$/
const stateKey = (key: string) => key.replace(/^jobs\//, 'jobs-state/')
const failedKey = (key: string) => key.replace(/^jobs\//, 'jobs-failed/')
const kickHere = () => process.env.USE_LOCAL_STORAGE === 'true' && !process.env.VITEST

/** Writes a job and returns its key. Await it before answering: that write is the promise to do the work. */
export async function enqueueJob<K extends JobKind>(kind: K, payload: Handlers[K], opts: { notBefore?: Date } = {}): Promise<string> {
  const key = `jobs/${kind}/${Date.now().toString(36)}-${nanoid(10)}.json`
  const job: Job<K> = { kind, payload, createdAt: new Date().toISOString(), ...(opts.notBefore ? { notBefore: opts.notBefore.toISOString() } : {}) }
  await putJson(key, job)
  if (kickHere()) setTimeout(() => { void runJob(key).catch(err => console.error('[jobs] local run failed', err)) }, 0)
  return key
}

export type RunOutcome = 'done' | 'gone' | 'not_due' | 'busy' | 'retry' | 'failed' | 'bad_key'

/** Runs one job, if it's there, due, and not already running. */
export async function runJob(key: string, now = Date.now()): Promise<RunOutcome> {
  if (!KEY.test(key)) return 'bad_key'
  const job = await getJson<Job>(key)
  if (!job) return 'gone'
  if (job.notBefore && Date.parse(job.notBefore) > now) return 'not_due'
  const state = (await getJson<JobState>(stateKey(key))) ?? { attempts: 0 }
  if (state.runningSince && now - Date.parse(state.runningSince) < LEASE_MS) return 'busy'
  if (state.retryAfter && Date.parse(state.retryAfter) > now) return 'not_due'

  const attempts = state.attempts + 1
  await putJson(stateKey(key), { attempts, runningSince: new Date(now).toISOString() } satisfies JobState)
  try {
    await (HANDLERS[job.kind] as (p: unknown) => Promise<void>)(job.payload)
    await deleteObject(key)
    await deleteObject(stateKey(key))
    return 'done'
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err)
    // Only giving up is an error (it trips the zero-tolerance alarm); an
    // attempt that will be retried is what the backoff is for.
    if (attempts < MAX_ATTEMPTS) console.warn(`[jobs] ${key} attempt ${attempts} failed, will retry`, err)
    else console.error(`[jobs] ${key} attempt ${attempts} failed, giving up`, err)
    if (attempts >= MAX_ATTEMPTS) {
      await putJson(failedKey(key), { ...job, attempts, lastError, failedAt: new Date(now).toISOString() })
      await deleteObject(key)
      await deleteObject(stateKey(key))
      return 'failed'
    }
    // Back off: 1, 2, 4, 8 minutes; the sweep picks it up then.
    const retryAfter = new Date(now + 60_000 * 2 ** (attempts - 1)).toISOString()
    await putJson(stateKey(key), { attempts, retryAfter, lastError } satisfies JobState)
    return 'retry'
  }
}

/** Runs every job that's due and not just announced, oldest first, within the time budget. */
export async function sweepJobs(now = Date.now()): Promise<Record<RunOutcome, number>> {
  const counts: Record<RunOutcome, number> = { done: 0, gone: 0, not_due: 0, busy: 0, retry: 0, failed: 0, bad_key: 0 }
  const keys = (await listKeys('jobs/')).filter(k => KEY.test(k)).sort()   // keys start with the time: oldest first
  const started = Date.now()
  for (const key of keys) {
    if (Date.now() - started > SWEEP_BUDGET_MS) break
    const job = await getJson<Job>(key)
    if (!job) continue
    if (now - Date.parse(job.createdAt) < FRESH_MS && !job.notBefore) continue
    counts[await runJob(key, now)]++
  }
  return counts
}
