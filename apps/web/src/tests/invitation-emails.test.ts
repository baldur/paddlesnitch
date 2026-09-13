// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

// Capture each sendEmail call so we can assert on subject/body/to without
// actually hitting SES. The route imports sendEmail from '@/lib/email';
// this mock replaces it before the route module is loaded.
const sentEmails: Array<{ to: string; subject: string; text: string }> = []
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push(input)
    return true
  }),
}))

import { POST as inviteToGroup } from '@/app/att/api/groups/[groupId]/invitations/route'
import { POST as createGroup } from '@/app/att/api/groups/route'
import { sendEmail } from '@/lib/email'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => {
  dataDir = await makeDataDir()
  sentEmails.length = 0
})
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(method: string, body?: unknown) {
  return new NextRequest('http://x/att/api/groups/c/invitations', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

// #53 — Baldur invited someone to a group but they had no account; we
// never emailed them, so they had no way to learn they were invited.
// These tests pin the new behaviour: every successful invite sends an
// email to the recipient, with copy tailored to whether they already
// have an account.
describe('#53 — group invitations send email to recipient', () => {
  it('emails a brand-new address with a signup link that lands on the group page', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    const res = await inviteToGroup(jsonReq('POST', { email: 'new-user@example.com' }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(201)

    expect(sentEmails).toHaveLength(1)
    const [email] = sentEmails
    expect(email.to).toBe('new-user@example.com')
    expect(email.subject).toContain('Endeavour Rowing')
    // cognito-local doesn't surface the `name` claim, so getAuthUser
    // falls back to the email local-part; the subject still ends in
    // "…invited you to join Endeavour Rowing", which is what we're
    // really asserting here.
    expect(email.subject).toMatch(/invited you to join/)
    // Signup link includes ?next= so the recipient lands on the group
    // after signup; applyPendingInvitations promotes the pending invite.
    expect(email.text).toMatch(/\/att\/auth\?[^\s]*next=/)
    expect(email.text).toMatch(/groups%2F[^\s&]+/)
  })

  it('emails an existing-account recipient with a direct group link (no signup)', async () => {
    const owner = await makeUser('Captain Cook')
    const guest = await makeUser('Already Member')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    const res = await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(201)

    expect(sentEmails).toHaveLength(1)
    const [email] = sentEmails
    expect(email.to).toBe(guest.email.toLowerCase())
    // The existing-account email goes straight to the group page — no
    // signup detour.
    expect(email.text).toContain(`/att/groups/${group.id}`)
    expect(email.text).not.toContain('?signup=')
  })

  it('mentions the admin role in the subject when inviting as an admin', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    await inviteToGroup(jsonReq('POST', { email: 'admin-recruit@example.com', role: 'admin' }),
      { params: Promise.resolve({ groupId: group.id }) })

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].text.toLowerCase()).toContain('admin')
  })

  it('skips the send for synthetic Strava emails (no real inbox)', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    const res = await inviteToGroup(
      jsonReq('POST', { email: 'strava-12345@noreply.paddlesnitch.com' }),
      { params: Promise.resolve({ groupId: group.id }) }
    )
    // The invitation itself still records (admin can still see it in
    // outstanding invites and the user can find it after linking a real
    // address) — but no email goes out because the address is a placeholder.
    expect(res.status).toBe(201)
    expect(sentEmails).toHaveLength(0)
  })

  // The SES grant on the server Lambda was too narrow, so sendEmail failed
  // silently in prod and invites went un-notified. The route now returns
  // `emailSent` so the UI can warn instead of the failure being invisible.
  it('reports emailSent:true when the send succeeds', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    const data = await (await inviteToGroup(jsonReq('POST', { email: 'new-user@example.com' }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(data.emailSent).toBe(true)
  })

  it('reports emailSent:false (but still 201) when the send fails', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    vi.mocked(sendEmail).mockResolvedValueOnce(false)
    mockAuth(owner.idToken)
    const res = await inviteToGroup(jsonReq('POST', { email: 'new-user@example.com' }),
      { params: Promise.resolve({ groupId: group.id }) })
    // The invite still persists — a failed email must not lose the invitation.
    expect(res.status).toBe(201)
    expect((await res.json()).emailSent).toBe(false)
  })

  it('reports emailSent:null when no real inbox is emailed (synthetic Strava address)', async () => {
    const owner = await makeUser('Captain Cook')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(owner.idToken)
    const data = await (await inviteToGroup(
      jsonReq('POST', { email: 'strava-12345@noreply.paddlesnitch.com' }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(data.emailSent).toBeNull()
  })

  it('a 403/404 invite does not trigger any email', async () => {
    const owner = await makeUser('Captain Cook')
    const stranger = await makeUser('Random')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'Endeavour Rowing' }))).json()

    mockAuth(stranger.idToken)
    const res = await inviteToGroup(jsonReq('POST', { email: 'noise@example.com' }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect([403, 404]).toContain(res.status)
    expect(sentEmails).toHaveLength(0)
  })
})
