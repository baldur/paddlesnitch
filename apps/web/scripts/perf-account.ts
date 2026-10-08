#!/usr/bin/env node
// Sets up the performance check's test account (docs/features/performance.md,
// decision 4), through the site's own APIs, so the check can time the
// signed-in pages and the data behind them. Safe to run again: it only adds
// what's missing.
//
//   PERF_PASSWORD=… npx tsx scripts/perf-account.ts [--base https://paddlesnitch.com]
//
// What it makes, all owned by the test account and nobody else:
//   - the account perf-check@paddlesnitch.com (signed up like anyone, ToS accepted);
//   - one paddle from a file (the Garmin export the parser tests use);
//   - a pretend tracker, F00DCAFE (no real tracker has that id), with one
//     recording and its motion data, which becomes a tracker paddle with
//     BOAT MOTION, as a real one does. The recording is a real 65-minute
//     paddle (the 13 Sep reference capture: PERF_CAPTURE_DIR, default
//     ~/Documents/paddlesnitch-tracker-capture-2026-09-13), cleaned and
//     reduced to 10 Hz as the tracker uploads it. (The repo's bench slice is
//     the paddle's stationary start: it never becomes a paddle.)
// The password lives in SSM (/att/perf-check-password); the check reads it there.

import { readFileSync } from 'fs'
import path from 'path'
import { randomBytes, createHash } from 'crypto'
import os from 'os'
import { decimateMotionCsv } from '@paddlesnitch/timing/cadence'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const BASE = (arg('base') ?? 'https://paddlesnitch.com').replace(/\/$/, '')
export const PERF_EMAIL = 'perf-check@paddlesnitch.com'
const PASSWORD = process.env.PERF_PASSWORD
const DEVICE = 'F00DCAFE'
const repo = path.resolve(__dirname, '../../..')

let cookie = ''
const req = async (p: string, init: RequestInit = {}) => {
  const res = await fetch(BASE + p, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  const set = res.headers.getSetCookie?.() ?? []
  const jar = new Map(cookie.split('; ').filter(Boolean).map(c => c.split('=') as [string, string]))
  for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
  cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return res
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const trpc = async (proc: string) => (await (await req(`/api/trpc/${proc}`)).json()).result?.data

async function main() {
  if (!PASSWORD || PASSWORD.length < 12) throw new Error('Set PERF_PASSWORD (12+ characters, upper, lower and a digit).')

  // 1. The account: sign in, or sign up the first time.
  let res = await req('/att/api/auth/login', json({ email: PERF_EMAIL, password: PASSWORD }))
  if (!res.ok) {
    res = await req('/att/api/auth/signup', json({ email: PERF_EMAIL, displayName: 'Performance check', password: PASSWORD, acceptedTosVersion: '002' }))
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
    console.log('signed up', PERF_EMAIL)
  } else console.log('signed in', PERF_EMAIL)

  // 2. A paddle from a file.
  const sessions = (await trpc('paddles.sessions')) as { source: { type: string } }[]
  if (!sessions.some(s => s.source.type === 'file')) {
    const fd = new FormData()
    fd.append('file', new Blob([readFileSync(path.join(repo, 'apps/web/src/tests/fixtures/garmin-activity-export.zip'))]), 'garmin-activity-export.zip')
    res = await req('/paddles/api/analyse', { method: 'POST', body: fd })
    console.log('file paddle:', res.status)
  }

  // 3. A pretend tracker with one recording and its motion data.
  const devices = ((await (await req('/api/account/devices')).json()).devices ?? []) as { deviceId: string }[]
  if (!devices.some(d => d.deviceId === DEVICE)) {
    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex')
    res = await req('/api/account/devices/link-bluetooth', json({ deviceId: DEVICE, tokenHash, model: 'perf-check', firmware: 'perf-check' }))
    console.log('tracker added:', res.status)
  }
  const hasTrackerPaddle = ((await trpc('paddles.sessions')) as { source: { type: string } }[]).some(p => p.source.type === 'device')
  if (!hasTrackerPaddle) {
    const dir = process.env.PERF_CAPTURE_DIR ?? path.join(os.homedir(), 'Documents/paddlesnitch-tracker-capture-2026-09-13')
    // A serial capture carries marker and status lines; keep the CSV rows.
    const clean = (text: string) => {
      const ls = text.split('\n'); const h = ls.findIndex(l => /^(timestamp|ms),/.test(l)); const n = ls[h].split(',').length
      return [ls[h], ...ls.slice(h + 1).filter(l => l.split(',').length === n)].join('\n') + '\n'
    }
    const track = Buffer.from(clean(readFileSync(path.join(dir, 'track_20260913_081130.csv'), 'utf8')))
    const motion = Buffer.from(decimateMotionCsv(clean(readFileSync(path.join(dir, 'track_20260913_081130_imu.csv'), 'utf8')), 10))
    const name = 'track_20260913_081130_perf.csv'
    for (const [file, body] of [[name, track], [name.replace('.csv', '_imu.csv'), motion]] as const) {
      // In 64 KB pieces numbered from 1, as the tracker and the Bluetooth page send them.
      const parts = Math.max(1, Math.ceil(body.length / 65536))
      for (let i = 1; i <= parts; i++) {
        res = await req(`/api/account/devices/${DEVICE}/sessions?filename=${file}&part=${i}&parts=${parts}`, {
          method: 'POST', headers: { 'content-type': 'text/csv' }, body: body.subarray((i - 1) * 65536, i * 65536),
        })
        const ok = res.status === 201 || res.status === 202 || (res.status === 409 && (await res.clone().json()).error === 'already_uploaded')
        if (!ok) throw new Error(`${file} part ${i}: ${res.status} ${await res.text()}`)
      }
      console.log(`${file}: ${res.status} (${parts} pieces)`)
    }
  }

  // 4. The tracker paddle is made after the upload answers: wait for it.
  for (let i = 0; i < 20; i++) {
    const all = (await trpc('paddles.sessions')) as { id: string; source: { type: string }; avgSR: number | null }[]
    const tracker = all.find(s => s.source.type === 'device')
    if (tracker) { console.log('tracker paddle', tracker.id, 'stroke rate', tracker.avgSR, '· paddles:', all.length); return }
    await new Promise(r => setTimeout(r, 3000))
  }
  console.log('the tracker paddle has not appeared yet; run again in a minute to check')
}

main().catch(err => { console.error(err); process.exit(1) })
