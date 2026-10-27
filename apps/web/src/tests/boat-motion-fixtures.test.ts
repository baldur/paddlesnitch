// @vitest-environment node
// The app contract's boat-motion fixtures are what the route really answers an
// app, rebuilt here from the same synthetic recordings (tracker-fixtures.ts), so
// a change to the maths or the answer can't leave the apps decoding stale numbers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { makeDataDir, cleanDataDir } from './helpers'
import { trackCsv, boatSidecar } from './tracker-fixtures'

const auth = vi.hoisted(() => ({ user: { id: 'u1', email: 'a@x', displayName: 'A' } }))
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => auth.user, getRequestUser: async () => auth.user }))

import { GET } from '@/app/api/account/devices/sessions/[sessionId]/route'
import { storeDeviceSession, storeDeviceMotion } from '@/lib/devices'
import { _clearDerivedMemory } from '@paddlesnitch/core/derived'
import { RecordingMotion } from '@paddlesnitch/api/contract'

const FIXTURES = path.join(__dirname, '../../../../mobile/contract/fixtures/api')
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, `account.devices-session${name}.json`), 'utf8'))
const D = 'C0FFEE01', S = 1200
const APP = { 'x-paddlesnitch-app': 'android/0.1.0' }

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); _clearDerivedMemory() })
afterEach(async () => { await cleanDataDir(dataDir) })

async function recording(name: string, motion?: string) {
  const { sessionId } = await storeDeviceSession({ deviceId: D, userId: 'u1', filename: name, startedAt: '', endedAt: '', distanceMetres: 3000, points: S }, trackCsv(S, 9, { startMs: 400_000 }))
  if (motion) await storeDeviceMotion(D, 'u1', name, motion, motion.split('\n').length - 1)
  return sessionId
}
const get = (sessionId: string, headers: Record<string, string> = APP) => GET(
  new Request(`http://x/api/account/devices/sessions/${sessionId}?deviceId=${D}`, { headers }),
  { params: Promise.resolve({ sessionId }) })
const answer = async (sessionId: string) => {
  const res = await get(sessionId)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(RecordingMotion.safeParse(body).error?.issues).toBeUndefined()
  return body
}

describe('the boat-motion fixtures are what the route answers an app', () => {
  it('measured', async () => {
    expect(await answer(await recording('track_20261025_0702.csv', boatSidecar(S, 10, 400_000)))).toEqual(fixture(''))
  })
  it('no motion file yet', async () => {
    expect(await answer(await recording('track_20261025_0702.csv'))).toEqual(fixture('.no-motion'))
  })
  it('a motion file too short to measure', async () => {
    expect(await answer(await recording('track_20261026_1800.csv', boatSidecar(9, 10, 400_000)))).toEqual(fixture('.motion-unusable'))
  })
  it('not found', async () => {
    const res = await get('nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(fixture('.not-found'))
  })
})

describe("the app's answer and the website's share an ETag, kept apart by Vary", () => {
  it('says it varies by the app header, and answers an app 304 for what it has', async () => {
    const id = await recording('track_20261025_0702.csv', boatSidecar(60, 10, 400_000))
    const first = await get(id)
    expect(first.headers.get('vary')).toContain('x-paddlesnitch-app')
    const etag = first.headers.get('etag')!
    const again = await get(id, { ...APP, 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(again.headers.get('vary')).toContain('x-paddlesnitch-app')
  })
})
