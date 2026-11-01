#!/usr/bin/env node
// One-off: switch Strava off for good (removed from the site 2026-11).
//
// Run ONCE against production BEFORE the "Remove Strava" PR is deployed (from
// then on, deleting an account no longer ends its Strava access, and the
// privacy page says it has ended), and before deleting the SSM parameters (it
// reads the client id and secret from them):
//   1. deletes our webhook subscription at Strava (so no more events arrive);
//   2. for every users/{id}/strava.json: ends our access at Strava
//      (POST /oauth/deauthorize; an expired token is refreshed first), then
//      deletes the file. A token Strava already refuses counts as ended. One
//      that fails for another reason (network, Strava down) is kept, so a
//      second run tries it again;
//   3. deletes every users/{id}/strava-prefs.json, strava-athletes/* and any
//      leftover Strava webhook job files (jobs*/strava-event/*).
// A refreshed token is saved before deauthorizing (Strava retires the old
// refresh token), so a run that fails halfway can still end it next time.
// It never touches paddles or anything else: only those key shapes.
// It prints counts only, never tokens, athlete ids or account ids.
//
// Dry run by default: lists what it would do and makes no calls to Strava.
// Add --apply to act.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/strava-shutdown.ts [--apply]
//
// Self-contained on purpose: the Strava code it would otherwise use is gone.

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'

const STRAVA = 'https://www.strava.com'
const TOKENS = /^users\/[^/]+\/strava\.json$/
const PREFS = /^users\/[^/]+\/strava-prefs\.json$/
const ATHLETE = /^strava-athletes\/[^/]+\.json$/
const JOB = /^jobs(-state|-failed)?\/strava-event\/[^/]+\.json$/

/** The few storage calls the script needs (the app's storage, or a fake in tests). */
export type Store = {
  listKeys(prefix: string): Promise<string[]>
  getJson<T>(key: string): Promise<T | null>
  putJson(key: string, value: unknown): Promise<void>
  deleteObject(key: string): Promise<void>
}
export type Creds = { clientId: string; clientSecret: string }
type Tokens = { accessToken?: string; refreshToken?: string; expiresAt?: number }
type Fetch = typeof fetch

export type Plan = { tokens: string[]; prefs: string[]; athletes: string[]; jobs: string[] }

/** What there is to clean up. Pure listing: only the three Strava key shapes. */
export async function plan(store: Store): Promise<Plan> {
  const users = await store.listKeys('users/')
  return {
    tokens: users.filter(k => TOKENS.test(k)).sort(),
    prefs: users.filter(k => PREFS.test(k)).sort(),
    athletes: (await store.listKeys('strava-athletes/')).filter(k => ATHLETE.test(k)).sort(),
    jobs: (await Promise.all(['jobs/', 'jobs-state/', 'jobs-failed/'].map(p => store.listKeys(`${p}strava-event/`))))
      .flat().filter(k => JOB.test(k)).sort(),
  }
}

const timeout = () => AbortSignal.timeout(10_000)

/**
 * A usable access token: the stored one, or a refreshed one if it has (nearly)
 * expired, then `save` gets the new tokens first. 'refused': Strava no longer
 * accepts it.
 */
export async function accessTokenFor(t: Tokens, creds: Creds, f: Fetch, nowS: number, save: (t: Tokens) => Promise<void> = async () => {}): Promise<string | 'refused'> {
  if (t.accessToken && (t.expiresAt ?? 0) - nowS > 60) return t.accessToken
  if (!t.refreshToken) return 'refused'
  const res = await f(`${STRAVA}/oauth/token`, {
    method: 'POST', signal: timeout(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'refresh_token', refresh_token: t.refreshToken }),
  })
  if (res.status === 400 || res.status === 401) return 'refused'
  if (!res.ok) throw new Error(`refresh answered ${res.status}`)
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_at?: number }
  if (!body.access_token) throw new Error('refresh gave no token')
  // Strava retires the old refresh token: keep the new one in case deauthorizing fails.
  await save({ ...t, accessToken: body.access_token, refreshToken: body.refresh_token ?? t.refreshToken, expiresAt: body.expires_at ?? t.expiresAt })
  return body.access_token
}

/** Ends our access for one athlete. 'ended' (now or already), else throws. */
export async function deauthorize(t: Tokens, creds: Creds, f: Fetch, nowS: number, save?: (t: Tokens) => Promise<void>): Promise<'ended'> {
  const token = await accessTokenFor(t, creds, f, nowS, save)
  if (token === 'refused') return 'ended'
  const res = await f(`${STRAVA}/oauth/deauthorize`, {
    method: 'POST', signal: timeout(), headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok || res.status === 401) return 'ended'
  throw new Error(`deauthorize answered ${res.status}`)
}

const subscriptionsUrl = (creds: Creds, id?: number) => {
  const q = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret })
  return `${STRAVA}/api/v3/push_subscriptions${id === undefined ? '' : `/${id}`}?${q}`
}

/** Our webhook subscriptions at Strava (there is at most one per app). */
export async function listSubscriptions(creds: Creds, f: Fetch): Promise<number[]> {
  const res = await f(subscriptionsUrl(creds), { signal: timeout() })
  if (!res.ok) throw new Error(`listing webhook subscriptions answered ${res.status}`)
  const body = (await res.json()) as { id?: number }[]
  return Array.isArray(body) ? body.map(s => s.id).filter((id): id is number => typeof id === 'number') : []
}

export type Report = {
  apply: boolean
  subscriptions: number; subscriptionsDeleted: number
  tokens: number; ended: number; failed: number
  prefsDeleted: number; athletesDeleted: number; jobsDeleted: number
}

export async function run(opts: { apply: boolean; store: Store; creds?: Creds; fetch?: Fetch; nowS?: number; log?: (line: string) => void }): Promise<Report> {
  const { apply, store } = opts
  const f = opts.fetch ?? fetch
  const nowS = opts.nowS ?? Math.floor(Date.now() / 1000)
  const log = opts.log ?? (line => console.log(line))
  const p = await plan(store)
  const report: Report = {
    apply, subscriptions: 0, subscriptionsDeleted: 0,
    tokens: p.tokens.length, ended: 0, failed: 0, prefsDeleted: 0, athletesDeleted: 0, jobsDeleted: 0,
  }

  if (!apply) {
    log(`strava-shutdown (dry run; add --apply): ${p.tokens.length} Strava connection(s) to end and delete, ${p.prefs.length} preference file(s) ${p.athletes.length} athlete index file(s) and ${p.jobs.length} webhook job file(s) to delete, and the webhook subscription. No calls made.`)
    return report
  }
  if (!opts.creds) throw new Error('no Strava client id/secret: run before deleting the SSM parameters')
  const creds = opts.creds

  // 1. The webhook first, so ending access below sends no events.
  const subs = await listSubscriptions(creds, f)
  report.subscriptions = subs.length
  for (const id of subs) {
    const res = await f(subscriptionsUrl(creds, id), { method: 'DELETE', signal: timeout() })
    if (res.ok || res.status === 404) report.subscriptionsDeleted++
    else log(`couldn't delete a webhook subscription (Strava answered ${res.status}); run again`)
  }

  // 2. Each connection: end it at Strava, then delete the file. Kept on failure.
  for (const key of p.tokens) {
    try {
      const t = await store.getJson<Tokens>(key)
      if (t) await deauthorize(t, creds, f, nowS, fresh => store.putJson(key, fresh))
      await store.deleteObject(key)
      report.ended++
    } catch {
      report.failed++
    }
  }

  // 3. What's left: preferences and the athlete index.
  for (const key of p.prefs) { await store.deleteObject(key); report.prefsDeleted++ }
  for (const key of p.athletes) { await store.deleteObject(key); report.athletesDeleted++ }
  for (const key of p.jobs) { await store.deleteObject(key); report.jobsDeleted++ }

  log(`strava-shutdown: webhook subscriptions deleted ${report.subscriptionsDeleted} of ${report.subscriptions}; connections ended and deleted ${report.ended} of ${report.tokens}${report.failed ? ` (${report.failed} failed and were kept: run again)` : ''}; preference files deleted ${report.prefsDeleted}; athlete index files deleted ${report.athletesDeleted}; webhook job files deleted ${report.jobsDeleted}.`)
  return report
}

async function credsFromSsm(): Promise<Creds> {
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm')
  const ssm = new SSMClient({ region: process.env.AWS_REGION || 'eu-west-1' })
  const get = async (Name: string) => {
    const v = (await ssm.send(new GetParameterCommand({ Name, WithDecryption: true }))).Parameter?.Value?.trim()
    if (!v) throw new Error(`SSM parameter ${Name} is empty`)
    return v
  }
  return { clientId: await get('/att/strava-client-id'), clientSecret: await get('/att/strava-client-secret') }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch { return false }
})()

if (invokedDirectly) {
  (async () => {
    const apply = process.argv.includes('--apply')
    const store = await import('../src/lib/storage')
    console.log(`bucket ${process.env.DATA_BUCKET || '(local files)'}`)
    const report = await run({ apply, store, creds: apply ? await credsFromSsm() : undefined })
    if (report.failed > 0) process.exitCode = 1
  })().catch(err => {
    // The message only: an SDK error could carry request details.
    console.error(`strava-shutdown stopped: ${err instanceof Error ? err.message : 'unknown error'}`)
    process.exit(1)
  })
}
