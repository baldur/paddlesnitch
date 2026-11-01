// @vitest-environment node
// Work done after answering (#413): a request writes a job file under jobs/
// and answers; S3 announces it to the kicker, which asks /api/jobs/run; a
// 5-minute sweep catches retries, jobs not due yet, and lost announcements.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { makeDataDir, cleanDataDir } from './helpers'

const made = vi.hoisted(() => ({ calls: [] as string[], fail: 0 }))
vi.mock('@paddlesnitch/analysis/tracker-paddle', () => ({
  paddleForRecording: async (_u: string, _d: string, id: string) => {
    made.calls.push(id)
    if (made.fail > 0) { made.fail--; throw new Error('the store had a moment') }
    return { status: 'created', paddleId: `t-${id}` }
  },
}))
vi.mock('@/lib/recording-report', () => ({ recordingReport: async () => null }))

import { enqueueJob, runJob, sweepJobs, MAX_ATTEMPTS } from '@/lib/jobs'
import { listKeys, getJson, putJson } from '@/lib/storage'
import { POST as runRoute } from '@/app/api/jobs/run/route'
import { POST as sweepRoute } from '@/app/api/jobs/sweep/route'

let dir: string
beforeEach(async () => { dir = await makeDataDir(); made.calls = []; made.fail = 0 })
afterEach(async () => { await cleanDataDir(dir) })

const job = (id = 's1', opts?: { notBefore?: Date }) => enqueueJob('tracker-paddle', { userId: 'u', deviceId: 'D', deviceSessionId: id }, opts)
const MIN = 60_000

describe('a job', () => {
  it('is a small file under jobs/, run once and then deleted', async () => {
    const key = await job()
    expect(key).toMatch(/^jobs\/tracker-paddle\/[\w-]+\.json$/)
    expect(await getJson(key)).toMatchObject({ kind: 'tracker-paddle', payload: { deviceSessionId: 's1' } })
    expect(made.calls).toEqual([])           // nothing ran while answering
    expect(await runJob(key)).toBe('done')
    expect(made.calls).toEqual(['s1'])
    expect(await listKeys('jobs/')).toEqual([])
    expect(await listKeys('jobs-state/')).toEqual([])
    expect(await runJob(key)).toBe('gone')   // announced twice: the second finds nothing
  })

  it('refuses anything that is not a job file', async () => {
    for (const k of ['../users/x.json', 'jobs/other/x.json', 'jobs/tracker-paddle/../../x.json', 'users/u/profile.json']) expect(await runJob(k)).toBe('bad_key')
  })

  it('retries with backoff, then gives up into jobs-failed/ with the reason', async () => {
    made.fail = 99
    const key = await job()
    let now = Date.now()
    expect(await runJob(key, now)).toBe('retry')
    expect(await getJson(key.replace('jobs/', 'jobs-state/'))).toMatchObject({ attempts: 1, lastError: 'the store had a moment' })
    expect(await runJob(key, now + 30_000)).toBe('not_due')        // backing off
    for (let a = 2; a <= MAX_ATTEMPTS; a++) {
      now += 2 ** (a - 1) * MIN
      expect(await runJob(key, now)).toBe(a === MAX_ATTEMPTS ? 'failed' : 'retry')
    }
    expect(made.calls).toHaveLength(MAX_ATTEMPTS)
    expect(await listKeys('jobs/')).toEqual([])
    expect(await getJson(key.replace('jobs/', 'jobs-failed/'))).toMatchObject({ attempts: MAX_ATTEMPTS, lastError: 'the store had a moment', payload: { deviceSessionId: 's1' } })
  })

  it('only the attempt that gives up is logged as an error; a retried attempt is a warning', async () => {
    // console.error means "we broke something" and trips the zero-tolerance
    // alarm (docs/features/observability.md); a retry is what backoff is for.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    made.fail = 99
    const key = await job()
    let now = Date.now()
    for (let a = 1; a <= MAX_ATTEMPTS; a++) {
      await runJob(key, now)
      now += 2 ** a * MIN
      expect(error).toHaveBeenCalledTimes(a === MAX_ATTEMPTS ? 1 : 0)
    }
    expect(warn).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1)
    expect(String(error.mock.calls[0][0])).toContain(`attempt ${MAX_ATTEMPTS} failed, giving up`)
    error.mockRestore(); warn.mockRestore()
  })

  it('a retry that works is done', async () => {
    made.fail = 1
    const key = await job()
    expect(await runJob(key)).toBe('retry')
    expect(await runJob(key, Date.now() + 2 * MIN)).toBe('done')
    expect(await listKeys('jobs-state/')).toEqual([])
  })

  it('is left alone while another run of it is going', async () => {
    const key = await job()
    await putJson(key.replace('jobs/', 'jobs-state/'), { attempts: 1, runningSince: new Date().toISOString() })
    expect(await runJob(key)).toBe('busy')
    expect(made.calls).toEqual([])
    expect(await runJob(key, Date.now() + 4 * MIN)).toBe('done')   // a run that died doesn't block it for ever
  })

  it('can wait for a time, and runs then', async () => {
    const key = await job('later', { notBefore: new Date(Date.now() + 10 * MIN) })
    expect(await runJob(key)).toBe('not_due')
    expect(await runJob(key, Date.now() + 11 * MIN)).toBe('done')
  })
})

describe('the sweep', () => {
  it('runs jobs that are due, oldest first, and leaves just-announced ones to their announcement', async () => {
    await job('old')
    await new Promise(r => setTimeout(r, 5))
    await job('older-by-a-hair')
    expect((await sweepJobs()).done).toBe(0)                  // both brand new
    const counts = await sweepJobs(Date.now() + 2 * MIN)
    expect(counts.done).toBe(2)
    expect(made.calls).toEqual(['old', 'older-by-a-hair'])
  })
})

describe('the endpoints the kicker calls', () => {
  const post = (body: unknown) => runRoute(new Request('http://x/api/jobs/run', { method: 'POST', body: JSON.stringify(body) }))
  it('run: runs the named job; anything else is refused or found gone', async () => {
    const key = await job()
    expect(await (await post({ key })).json()).toEqual({ outcome: 'done' })
    expect(await (await post({ key })).json()).toEqual({ outcome: 'gone' })
    expect(await (await post({ key: 'users/u/x.json' })).json()).toEqual({ outcome: 'bad_key' })
    expect((await post({})).status).toBe(400)
  })
  it('sweep: answers with what it did', async () => {
    const res = await sweepRoute()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ done: 0 })
  })
})

describe('the kicker', () => {
  const root = path.join(__dirname, '../../../..')
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks the server to run each new job file, and to sweep on the timer', async () => {
    process.env.SITE_URL = 'https://site.test'
    const calls: [string, string][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push([url, String(init.body)]); return new Response('{"outcome":"done"}') }))
    const { handler } = await import(path.join(root, 'infra/lambdas/jobs-kicker/index.mjs'))
    await handler({ Records: [{ s3: { object: { key: 'jobs/tracker-paddle/abc-123.json' } } }, { s3: { object: { key: 'users/x.json' } } }] })
    await handler({ sweep: true })
    expect(calls).toEqual([
      ['https://site.test/api/jobs/run', JSON.stringify({ key: 'jobs/tracker-paddle/abc-123.json' })],
      ['https://site.test/api/jobs/sweep', '{}'],
    ])
  })

  it('throws when the server says no, so Lambda tries the announcement again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })))
    const { handler } = await import(path.join(root, 'infra/lambdas/jobs-kicker/index.mjs'))
    await expect(handler({ Records: [{ s3: { object: { key: 'jobs/tracker-paddle/a.json' } } }] })).rejects.toThrow(/502/)
  })

  it('is wired to new files under jobs/ and to a 5-minute timer', () => {
    const stack = readFileSync(path.join(root, 'infra/lib/att-stack.ts'), 'utf8')
    expect(stack).toMatch(/addEventNotification\(\s*s3\.EventType\.OBJECT_CREATED,\s*new s3n\.LambdaDestination\(jobsKicker\),\s*\{ prefix: 'jobs\/' \}/)
    expect(stack).toMatch(/'JobsSweep', \{\s*schedule: events\.Schedule\.rate\(cdk\.Duration\.minutes\(5\)\)/)
    // The runner's bookkeeping lives outside jobs/, so writing it never announces a new job.
    expect(readFileSync(path.join(root, 'apps/web/src/lib/jobs.ts'), 'utf8')).toContain("replace(/^jobs\\//, 'jobs-state/')")
  })
})
