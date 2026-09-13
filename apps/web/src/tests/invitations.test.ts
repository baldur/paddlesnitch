// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser, makeCourse, makeTrial } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as listInvitations, POST as createInvitation } from '@/app/att/api/trials/[trialId]/invitations/route'
import { DELETE as removeInvitation } from '@/app/att/api/trials/[trialId]/invitations/[userId]/route'
import { GET as getTrial, PATCH as patchTrial } from '@/app/att/api/trials/[trialId]/route'
import { POST as upload } from '@/app/att/api/trials/[trialId]/upload/route'
import { GET as canSubmit } from '@/app/att/api/trials/[trialId]/can-submit/route'
import { addUserToGroupIndex, newGroup, putGroup } from '@/lib/groups'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => name === 'tt_id' && idToken ? { name, value: idToken } : undefined,
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}

function jsonReq(method: string, body?: unknown) {
  return new NextRequest('http://x', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Story-style permission tests for phase 2 trial invitations. Names map to
// rows of the permission matrix in docs/features/visibility-groups-tos.md.

describe('inviting a user to an invitational trial', () => {
  it('the owner can invite a known account by email', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'invitational' })

    mockAuth(owner.idToken)
    const res = await createInvitation(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.invitee.sub).toBe(guest.id)
    expect(body.invitee.email.toLowerCase()).toBe(guest.email.toLowerCase())
  })

  it('a non-owner cannot invite, even with a valid email', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'invitational' })

    mockAuth(stranger.idToken)
    const res = await createInvitation(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(403)
  })

  it('an unauthenticated request is rejected with 401', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'invitational' })

    mockAuth(null)
    const res = await createInvitation(jsonReq('POST', { email: 'noone@example.com' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(401)
  })

  it('an unknown email yields 422 (no account) — owner is told to double-check', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'invitational' })

    mockAuth(owner.idToken)
    const res = await createInvitation(
      jsonReq('POST', { email: `nobody-${Date.now()}@example.com` }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(422)
  })

  it('re-inviting an already-invited account is idempotent (201, no dupes)', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(owner.idToken)
    const res = await createInvitation(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(201)

    // Read the persisted record to verify no duplication.
    const reread = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    const trialBody = await reread.json()
    expect(trialBody.invitedUserIds.filter((s: string) => s === guest.id)).toHaveLength(1)
  })
})

describe('uninviting a user', () => {
  it('the owner can remove an invitation', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(owner.idToken)
    const res = await removeInvitation(jsonReq('DELETE'),
      { params: Promise.resolve({ trialId: trial.id, userId: guest.id }) })
    expect(res.status).toBe(200)

    const reread = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect((await reread.json()).invitedUserIds).not.toContain(guest.id)
  })

  it('a non-owner cannot remove invitations', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(stranger.idToken)
    const res = await removeInvitation(jsonReq('DELETE'),
      { params: Promise.resolve({ trialId: trial.id, userId: guest.id }) })
    expect(res.status).toBe(403)
  })
})

describe('uploading to an invitational trial', () => {
  it('an invited user can upload', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(guest.idToken)
    const req = new NextRequest(`http://x`, { method: 'POST', body: new FormData() })
    const res = await upload(req,
      { params: Promise.resolve({ trialId: trial.id }) })
    // 400 here means the form data was empty (no file) — we got past the
    // permission gate, which is the assertion we care about. Anything in
    // the 4xx range OTHER than 404 confirms "you can see this, but you
    // didn't post anything useful". 404 would mean the gate blocked us.
    expect(res.status).not.toBe(404)
  })

  it('a non-invited signed-in user is blocked (404 — no leak of guest list)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational' })

    mockAuth(stranger.idToken)
    const req = new NextRequest(`http://x`, { method: 'POST', body: new FormData() })
    const res = await upload(req,
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('the owner can always upload to their own invitational trial', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational' })

    mockAuth(owner.idToken)
    const req = new NextRequest(`http://x`, { method: 'POST', body: new FormData() })
    const res = await upload(req,
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).not.toBe(404)
  })
})

describe('uploading to a members trial (phase 3)', () => {
  const GROUP = 'grp-members-1' // membership is just the reverse-index entry

  it('a member of the trial\'s group can upload', async () => {
    const owner = await makeUser('Owner')
    const member = await makeUser('Member')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'members', groupId: GROUP })
    await addUserToGroupIndex(member.id, GROUP)

    mockAuth(member.idToken)
    const res = await upload(new NextRequest('http://x', { method: 'POST', body: new FormData() }),
      { params: Promise.resolve({ trialId: trial.id }) })
    // Past the gate (empty form → some other 4xx, just not the 404 the gate returns).
    expect(res.status).not.toBe(404)
  })

  it('a non-member is blocked (404 — same as not-found, no leak)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'members', groupId: GROUP })

    mockAuth(stranger.idToken)
    const res = await upload(new NextRequest('http://x', { method: 'POST', body: new FormData() }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('the organiser can always upload to their members trial', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'members', groupId: GROUP })

    mockAuth(owner.idToken)
    const res = await upload(new NextRequest('http://x', { method: 'POST', body: new FormData() }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).not.toBe(404)
  })
})

describe('shareable submit link (invite token)', () => {
  const params = (trialId: string) => ({ params: Promise.resolve({ trialId }) })

  // A real group the owner actually admins — so the owner can mint the token
  // (canManageTrial checks group admin), while a stranger is not a member
  // (canSubmitToTrial 'members' stays blocked until the token bypasses it).
  async function ownerWithGroup() {
    const owner = await makeUser('Owner')
    const group = newGroup({ name: 'G', ownerId: owner.id })
    await putGroup(group)
    await addUserToGroupIndex(owner.id, group.id)
    return { owner, groupId: group.id }
  }

  async function membersTrialWithToken() {
    const { owner, groupId } = await ownerWithGroup()
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'members', groupId })
    mockAuth(owner.idToken)
    const patched = await (await patchTrial(jsonReq('PATCH', { regenerateSubmitToken: true }), params(trial.id))).json()
    return { trial, token: patched.submitToken as string }
  }

  it('a non-manager cannot mint a token', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open')
    mockAuth(stranger.idToken)
    const res = await patchTrial(jsonReq('PATCH', { regenerateSubmitToken: true }), params(trial.id))
    expect(res.status).toBe(403)
  })

  it('a valid token lets a non-member submit to a members trial; wrong/absent token does not', async () => {
    const { trial, token } = await membersTrialWithToken()
    expect(token).toBeTruthy()
    const stranger = await makeUser('Stranger')
    mockAuth(stranger.idToken)

    // No token → blocked.
    const blocked = await upload(new NextRequest('http://x', { method: 'POST', body: new FormData() }), params(trial.id))
    expect(blocked.status).toBe(404)
    // Wrong token → blocked.
    const wrong = await upload(new NextRequest('http://x?invite=nope', { method: 'POST', body: new FormData() }), params(trial.id))
    expect(wrong.status).toBe(404)
    // Valid token → past the gate (empty form → some other 4xx, not the 404 the gate returns).
    const ok = await upload(new NextRequest(`http://x?invite=${token}`, { method: 'POST', body: new FormData() }), params(trial.id))
    expect(ok.status).not.toBe(404)
  })

  it('can-submit reports canSubmit with a valid token, and members-blocked without', async () => {
    const { trial, token } = await membersTrialWithToken()
    const stranger = await makeUser('Stranger')
    mockAuth(stranger.idToken)

    const without = await (await canSubmit(new NextRequest('http://x'), params(trial.id))).json()
    expect(without.canSubmit).toBe(false)
    expect(without.reason).toBe('members')

    const withTok = await (await canSubmit(new NextRequest(`http://x?invite=${token}`), params(trial.id))).json()
    expect(withTok.canSubmit).toBe(true)
  })

  it('revoking the token disables it', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'members', groupId })
    mockAuth(owner.idToken)
    const token = (await (await patchTrial(jsonReq('PATCH', { regenerateSubmitToken: true }), params(trial.id))).json()).submitToken
    mockAuth(owner.idToken)
    await patchTrial(jsonReq('PATCH', { submitToken: null }), params(trial.id))

    const stranger = await makeUser('Stranger')
    mockAuth(stranger.idToken)
    const res = await upload(new NextRequest(`http://x?invite=${token}`, { method: 'POST', body: new FormData() }), params(trial.id))
    expect(res.status).toBe(404) // token no longer matches
  })
})

describe('viewing a private invitational trial', () => {
  it('an invitee can view the trial detail (widened in phase 2)', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { visibility: 'private', participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(guest.idToken)
    const res = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
  })

  it('a non-invited stranger still gets 404', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { visibility: 'private', participation: 'invitational' })

    mockAuth(stranger.idToken)
    const res = await getTrial(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(404)
  })

  it('an invitee cannot manage the trial', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { visibility: 'private', participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(guest.idToken)
    const res = await patchTrial(jsonReq('PATCH', { name: 'Hijacked' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(403)
  })
})

describe('flipping participation', () => {
  it('the owner can flip a trial from public to invitational', async () => {
    const owner = await makeUser('Owner')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open', { participation: 'public' })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { participation: 'invitational' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).participation).toBe('invitational')
  })

  it('flipping back to public keeps the invitee list intact (so flipping again does not surprise the owner)', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(owner.idToken)
    const res = await patchTrial(jsonReq('PATCH', { participation: 'public' }),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.participation).toBe('public')
    expect(body.invitedUserIds).toContain(guest.id)
  })
})

describe('listing the invitees', () => {
  it('the owner sees the resolved profile list', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational', invitedUserIds: [guest.id] })

    mockAuth(owner.idToken)
    const res = await listInvitations(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invitees).toHaveLength(1)
    expect(body.invitees[0].sub).toBe(guest.id)
  })

  it('a non-owner gets 403', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    const course = await makeCourse(owner.id)
    const trial = await makeTrial(course.id, owner.id, 'open',
      { participation: 'invitational' })

    mockAuth(stranger.idToken)
    const res = await listInvitations(new NextRequest('http://x'),
      { params: Promise.resolve({ trialId: trial.id }) })
    expect(res.status).toBe(403)
  })
})
