// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeGpxBuffer } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as validateTrace } from '@/app/att/api/courses/validate-trace/route'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function validateReq(file: File, geometry: unknown) {
  const form = new FormData()
  form.append('file', file)
  form.append('geometry', JSON.stringify(geometry))
  return new NextRequest('http://x/att/api/courses/validate-trace', { method: 'POST', body: form })
}

// Northbound track crossing lat 0.001 then lat 0.005 (both +1 direction).
function northboundTrace(): File {
  const gpx = makeGpxBuffer([
    [0.000, 0, '2024-06-01T10:00:00Z'],
    [0.002, 0, '2024-06-01T10:00:10Z'],  // crosses gate at lat 0.001 (+1)
    [0.004, 0, '2024-06-01T10:00:20Z'],
    [0.006, 0, '2024-06-01T10:00:30Z'],  // crosses gate at lat 0.005 (+1)
  ])
  return new File([gpx], 'reference.gpx')
}

const gate0 = { line: [[0.001, -0.001], [0.001, 0.001]], direction: 1 as const }
const gate1Up = { line: [[0.005, -0.001], [0.005, 0.001]], direction: 1 as const }
const gate1Down = { line: [[0.005, -0.001], [0.005, 0.001]], direction: -1 as const }

describe('POST /att/api/courses/validate-trace', () => {
  it('returns 401 when not signed in', async () => {
    mockAuth(null)
    const res = await validateTrace(validateReq(northboundTrace(), { type: 'gate', gates: [gate0, gate1Up] }))
    expect(res.status).toBe(401)
  })

  it('reports a match when the reference trace passes every gate correctly', async () => {
    const user = await makeUser()
    mockAuth(user.idToken)
    const res = await validateTrace(validateReq(northboundTrace(), { type: 'gate', gates: [gate0, gate1Up] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matched).toBe(true)
    expect(body.totalElapsedSeconds).toBeGreaterThan(0)
  })

  it('reports the offending gate when a gate direction is backwards', async () => {
    const user = await makeUser()
    mockAuth(user.idToken)
    // gate 2 requires -1, but the reference trace crosses it +1.
    const res = await validateTrace(validateReq(northboundTrace(), { type: 'gate', gates: [gate0, gate1Down] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matched).toBe(false)
    expect(body.gateAnalysis.blocking).toEqual({ gateNumber: 2, requiredDirection: -1, reason: 'wrong_direction' })
    expect(body.message).toMatch(/Gate 2 was crossed in the opposite direction/)
  })

  it('returns 400 when a gate course has fewer than 2 gates', async () => {
    const user = await makeUser()
    mockAuth(user.idToken)
    const res = await validateTrace(validateReq(northboundTrace(), { type: 'gate', gates: [gate0] }))
    expect(res.status).toBe(400)
  })

  it('returns 422 for an unparseable file', async () => {
    const user = await makeUser()
    mockAuth(user.idToken)
    const res = await validateTrace(validateReq(new File(['nonsense'], 'data.txt'), { type: 'gate', gates: [gate0, gate1Up] }))
    expect(res.status).toBe(422)
  })
})
