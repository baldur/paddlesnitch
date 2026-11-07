// @vitest-environment node
// Behind CloudFront the request's own host is the server's function URL
// (CloudFront doesn't pass the viewer's Host). Links the public API, MCP and
// redirects hand out must say paddlesnitch.com: the function URL is meant to
// stay unknown, and since #908 it refuses requests that skip CloudFront.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir } from './helpers'
import { putJson } from '@/lib/storage'
import { GET as plan } from '@/app/api/v1/plan/route'
import { GET as trials } from '@/app/api/v1/trials/route'
import { GET as trial } from '@/app/api/v1/trials/[trialId]/route'
import { GET as openapi } from '@/app/api/v1/openapi.json/route'
import { POST as mcp } from '@/app/mcp/route'
import { GET as magicVerify } from '@/app/att/api/auth/magic-verify/route'

const FN = 'https://abc123xyz.lambda-url.eu-west-1.on.aws'
const req = (p: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(p, FN), init)

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://paddlesnitch.com')
  await putJson('courses/c1/metadata.json', {
    id: 'c1', name: 'Harbour 500', sport: 'kayak', type: 'point_to_point',
    startLine: [[64.15, -21.95], [64.151, -21.95]], finishLine: [[64.155, -21.95], [64.156, -21.95]],
    distanceMetres: 500, adminUserId: 'u-admin', visibility: 'public', createdAt: '2026-01-01T00:00:00Z',
  })
  await putJson('trials/pub/metadata.json', {
    id: 'pub', name: 'Public race', courseId: 'c1', date: '2026-06-01', status: 'open', adminUserId: 'u-admin',
    participation: 'public', visibility: 'public', invitedUserIds: [], createdAt: '2026-01-01T00:00:00Z',
  })
})
afterEach(async () => { vi.unstubAllEnvs(); await cleanDataDir(dataDir) })

const noFunctionUrl = (text: string) => {
  expect(text).not.toContain('lambda-url')
  expect(text).toContain('https://paddlesnitch.com')
}

describe('links say paddlesnitch.com when the request arrives at the function URL', () => {
  it('the OpenAPI servers entry', async () => {
    noFunctionUrl(await (await openapi(req('/api/v1/openapi.json'))).text())
  })

  it('trial links, listed and one at a time', async () => {
    const listed = await (await trials(req('/api/v1/trials'))).json()
    expect(listed.trials[0].links.page).toBe('https://paddlesnitch.com/att/trials/pub')
    noFunctionUrl(JSON.stringify(listed))
    const one = await (await trial(req('/api/v1/trials/pub'), { params: Promise.resolve({ trialId: 'pub' }) })).json()
    expect(one.trial.links.leaderboard).toMatch(/^https:\/\/paddlesnitch\.com\//)
    noFunctionUrl(JSON.stringify(one))
  })

  it('the plan page link', async () => {
    const body = await (await plan(req('/api/v1/plan?from=guyers-lock&to=aldermaston-wharf'))).json()
    expect(body.links.page).toMatch(/^https:\/\/paddlesnitch\.com\/plan\?/)
    noFunctionUrl(JSON.stringify(body))
  })

  it('locally (no NEXT_PUBLIC_BASE_URL) links follow the dev server, whatever its port', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', undefined)
    const res = await openapi(new NextRequest('http://localhost:3123/api/v1/openapi.json'))
    expect((await res.json()).servers[0].url).toBe('http://localhost:3123')
  })

  it('links in MCP tool results', async () => {
    const res = await mcp(req('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_trial', arguments: { trial_id: 'pub' } } }),
    }))
    noFunctionUrl(await res.text())
  })

  it('the old magic-link redirect', async () => {
    const res = await magicVerify(req('/att/api/auth/magic-verify?token=x'))
    expect(res.headers.get('location')).toBe('https://paddlesnitch.com/signin?error=magic_disabled')
  })
})
