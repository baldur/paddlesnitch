// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as feedback } from '@/app/att/api/feedback/route'
import { cookies } from 'next/headers'

let dataDir: string
let fetchSpy: ReturnType<typeof vi.spyOn>
const originalFetch = global.fetch
// Capture GitHub-bound fetch calls separately from other traffic (e.g.
// JWKS fetches by aws-jwt-verify which we must NOT intercept — they need
// to reach cognito-local).
let githubCalls: { url: string; init: RequestInit }[]
let githubResponse: () => Response

beforeEach(async () => {
  dataDir = await makeDataDir()
  process.env.GITHUB_ISSUES_TOKEN = 'test-token'
  process.env.GITHUB_REPO = 'test/repo'
  githubCalls = []
  githubResponse = () => new Response(
    JSON.stringify({ number: 99, html_url: 'https://github.com/test/repo/issues/99' }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  )
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request | URL).toString()
    if (url.startsWith('https://api.github.com/')) {
      githubCalls.push({ url, init: init ?? {} })
      return githubResponse()
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init)
  }) as typeof fetch)
})
afterEach(async () => {
  fetchSpy.mockRestore()
  delete process.env.GITHUB_ISSUES_TOKEN
  delete process.env.GITHUB_REPO
  await cleanDataDir(dataDir)
})

function mockAnonymous() {
  vi.mocked(cookies).mockResolvedValue({
    get: () => undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
function mockAuth(idToken: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(body: Record<string, unknown>) {
  // Default to a value above the anti-bot floor so existing tests don't
  // have to know about it. Per-test overrides still win via spread order.
  const merged = { elapsedMs: 5000, ...body }
  return new NextRequest('http://x/att/api/feedback', {
    method: 'POST',
    body: JSON.stringify(merged),
    headers: { 'Content-Type': 'application/json' },
  })
}

function sentBody(): { title: string; body: string; labels: string[] } {
  expect(githubCalls).toHaveLength(1)
  return JSON.parse(githubCalls[0].init.body as string)
}

describe('POST /att/api/feedback', () => {
  it('files a GitHub issue with the customer-reported + triage labels', async () => {
    mockAnonymous()
    const res = await feedback(jsonReq({
      description: 'The leaderboard never loads on my trial.',
      url: 'https://paddlesnitch.com/att/trials/abc',
      userAgent: 'Mozilla/5.0',
      viewport: '1440x900',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.issueNumber).toBe(99)

    expect(githubCalls).toHaveLength(1)
    expect(githubCalls[0].url).toBe('https://api.github.com/repos/test/repo/issues')
    expect((githubCalls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token')
    const sent = sentBody()
    expect(sent.labels).toEqual(['customer-reported', 'triage'])
    expect(sent.title).toBe('[customer] The leaderboard never loads on my trial.')
    expect(sent.body).toContain('The leaderboard never loads on my trial.')
    expect(sent.body).toContain('https://paddlesnitch.com/att/trials/abc')
    expect(sent.body).toContain('Reporter: anonymous')
  })

  it('captures the signed-in user when present', async () => {
    const user = await makeUser('Alice')
    mockAuth(user.idToken)

    await feedback(jsonReq({ description: 'The upload form crashed.', url: 'https://paddlesnitch.com/att' }))

    const sent = sentBody()
    expect(sent.body).toContain(user.email)
    expect(sent.body).toContain(user.id)
  })

  it('falls back to the supplied email when not signed in', async () => {
    mockAnonymous()
    await feedback(jsonReq({
      description: 'I cannot find the open trial.',
      email: 'paddler@example.com',
    }))
    expect(sentBody().body).toContain('paddler@example.com (no account)')
  })

  it('returns 400 when the description is too short', async () => {
    mockAnonymous()
    const res = await feedback(jsonReq({ description: 'hi' }))
    expect(res.status).toBe(400)
    expect(githubCalls).toHaveLength(0)
  })

  it('returns 400 when description is missing entirely', async () => {
    mockAnonymous()
    const res = await feedback(jsonReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 503 when the GitHub token is not configured', async () => {
    delete process.env.GITHUB_ISSUES_TOKEN
    mockAnonymous()
    const res = await feedback(jsonReq({ description: 'Something broke big-time' }))
    expect(res.status).toBe(503)
  })

  it('returns 502 (without leaking GitHub details) when the GitHub API fails', async () => {
    mockAnonymous()
    githubResponse = () => new Response(
      JSON.stringify({ message: 'Bad credentials' }), { status: 401 },
    )

    const res = await feedback(jsonReq({ description: 'A reproducible flake on upload' }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).not.toContain('Bad credentials')
  })

  it('caps description length at 5000 characters', async () => {
    mockAnonymous()
    const huge = 'x'.repeat(10_000)
    await feedback(jsonReq({ description: huge }))
    expect(sentBody().body.length).toBeLessThan(6000)
  })

  it('silently drops bot submissions that fill the honeypot field', async () => {
    mockAnonymous()
    const res = await feedback(jsonReq({
      description: 'Buy cheap watches at example.com',
      website: 'http://spam.example',
    }))
    // Looks like success to the bot — no signal to retry differently.
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(githubCalls).toHaveLength(0)
  })

  it('silently drops bot submissions that come in faster than a human could type', async () => {
    mockAnonymous()
    const res = await feedback(jsonReq({
      description: 'A reasonable-looking report.',
      elapsedMs: 100,
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(githubCalls).toHaveLength(0)
  })
})
