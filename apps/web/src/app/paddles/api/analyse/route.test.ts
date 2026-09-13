// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// Auth is mocked to a fixed user; storage is the real local-fs backend against a
// temp dir (like the store tests). No LLM backend is configured, so the insight
// falls back to the deterministic template — the route still returns + saves.
const USER = { id: 'user-1', email: 'p@example.com', displayName: 'Pat' }
vi.mock('@paddlesnitch/core/auth', () => ({ getAuthUser: () => Promise.resolve(USER) }))
// `after()` needs a request scope that doesn't exist in a bare test — run its
// callback inline so the profile refresh still exercises, keeping NextRequest/
// NextResponse real.
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
// Real conditions are external HTTP (Open-Meteo / EA); the route already tolerates
// null, and a route test must not hit the network. (They're covered elsewhere.)
vi.mock('@paddlesnitch/timing/weather', () => ({ getWeatherAt: () => Promise.resolve(null) }))
vi.mock('@paddlesnitch/timing/river-flow', () => ({ getFlowAt: () => Promise.resolve(null) }))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'

// A minimal GPX the real parser accepts: N timestamped points moving north.
function gpx(points = 30, startIso = '2026-08-10T09:00:00Z'): string {
  const t0 = new Date(startIso).getTime()
  const rows = Array.from({ length: points }, (_, i) => {
    const t = new Date(t0 + i * 3000).toISOString()
    return `<trkpt lat="${(51.46 + i * 0.0004).toFixed(6)}" lon="-0.93"><time>${t}</time></trkpt>`
  }).join('')
  return `<?xml version="1.0"?><gpx><trk><trkseg>${rows}</trkseg></trk></gpx>`
}

function postWith(file?: File): Promise<Response> {
  const form = new FormData()
  if (file) form.set('file', file)
  return POST(new NextRequest('http://localhost/analyse', { method: 'POST', body: form }))
}

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analyse-route-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
  delete process.env.LLM_BACKEND        // no LLM → deterministic template insight
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

describe('POST /paddles', () => {
  it('analyses a GPX upload, returns a result, and saves it to the library', async () => {
    const res = await postWith(new File([gpx()], 'paddle.gpx'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.distanceKm).toBeGreaterThan(0)
    expect(body.insight).toBeTruthy()          // template fallback, never blank
    const saved = await listSessionSummaries(USER.id)
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(body.id)
  })

  it('recognises a re-uploaded paddle as a duplicate instead of saving twice', async () => {
    const first = await (await postWith(new File([gpx()], 'paddle.gpx'))).json()
    const second = await postWith(new File([gpx()], 'paddle.gpx'))
    const body = await second.json()
    expect(body.duplicate).toBe(true)
    expect(body.id).toBe(first.id)                       // points at the existing one
    expect(await listSessionSummaries(USER.id)).toHaveLength(1)   // not duplicated
  })

  it('rejects an unreadable file with a 422, not a 500', async () => {
    const res = await postWith(new File(['not a track'], 'junk.gpx'))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBeTruthy()
  })

  it('asks for input with a 400 when no file or activity is provided', async () => {
    const res = await postWith()
    expect(res.status).toBe(400)
  })
})
