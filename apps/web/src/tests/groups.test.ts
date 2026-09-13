// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { GET as listGroups, POST as createGroup } from '@/app/att/api/groups/route'
import { GET as getGroupRoute, PATCH as patchGroup, DELETE as deleteGroupRoute } from '@/app/att/api/groups/[groupId]/route'
import { POST as inviteToGroup, GET as listInvites } from '@/app/att/api/groups/[groupId]/invitations/route'
import { POST as acceptInvite } from '@/app/att/api/groups/[groupId]/invitations/[invitationId]/accept/route'
import { DELETE as kickMember } from '@/app/att/api/groups/[groupId]/members/[userId]/route'
import { POST as requestJoin, GET as listJoinReqs } from '@/app/att/api/groups/[groupId]/join-requests/route'
import { POST as approveJoin } from '@/app/att/api/groups/[groupId]/join-requests/[requestId]/approve/route'
import { POST as declineJoin } from '@/app/att/api/groups/[groupId]/join-requests/[requestId]/decline/route'
import { GET as getCourse } from '@/app/att/api/courses/[courseId]/route'
import { POST as createCourse } from '@/app/att/api/courses/route'
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

// Story-style permission tests for phase 4 groups.
// docs/features/visibility-groups-tos.md.

describe('creating a group', () => {
  it('any signed-in user can create one and becomes the owner', async () => {
    const founder = await makeUser('Founder')
    mockAuth(founder.idToken)
    const res = await createGroup(jsonReq('POST', { name: 'Founder Group' }))
    expect(res.status).toBe(201)
    const group = await res.json()
    expect(group.ownerId).toBe(founder.id)
    expect(group.name).toBe('Founder Group')
  })

  it('an unauthenticated request gets 401', async () => {
    mockAuth(null)
    const res = await createGroup(jsonReq('POST', { name: 'X' }))
    expect(res.status).toBe(401)
  })

  it('an empty name is rejected', async () => {
    const u = await makeUser('U')
    mockAuth(u.idToken)
    const res = await createGroup(jsonReq('POST', { name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('appears in the creator\'s own /att/api/groups list', async () => {
    const u = await makeUser('U')
    mockAuth(u.idToken)
    await createGroup(jsonReq('POST', { name: 'Mine' }))
    mockAuth(u.idToken)
    const list = await (await listGroups(new NextRequest('http://x/att/api/groups'))).json()
    expect(list.groups.map((c: { name: string }) => c.name)).toContain('Mine')
  })

  it('does NOT appear in a stranger\'s list', async () => {
    const u = await makeUser('U')
    const stranger = await makeUser('Stranger')
    mockAuth(u.idToken)
    await createGroup(jsonReq('POST', { name: 'Hidden' }))
    mockAuth(stranger.idToken)
    const list = await (await listGroups(new NextRequest('http://x/att/api/groups'))).json()
    expect(list.groups.map((c: { name: string }) => c.name)).not.toContain('Hidden')
  })
})

describe('viewing a group', () => {
  it('a member can view the full payload', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(owner.idToken)
    const res = await getGroupRoute(new NextRequest('http://x'),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)
  })

  it('a non-member gets a limited view — name + counts, but no member list (phase 4)', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(stranger.idToken)
    const res = await getGroupRoute(new NextRequest('http://x'),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('C')
    expect(body.limited).toBe(true)
    expect(body.viewerStatus).toBe('none')
    expect(body.memberUserIds).toBeUndefined() // member list stays hidden
  })

  it('an unauthenticated visitor also gets the limited view (discoverable by link)', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(null)
    const res = await getGroupRoute(new NextRequest('http://x'),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.limited).toBe(true)
    expect(body.memberUserIds).toBeUndefined()
  })
})

describe('inviting and joining', () => {
  it('the owner can invite an existing user; they accept and become a member', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(owner.idToken)
    const inviteRes = await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(inviteRes.status).toBe(201)
    const { invitation, resolved } = await inviteRes.json()
    expect(resolved).toBe(true)

    mockAuth(guest.idToken)
    const acceptRes = await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: invitation.id }) })
    expect(acceptRes.status).toBe(200)

    // Guest can now view the group.
    mockAuth(guest.idToken)
    const view = await getGroupRoute(new NextRequest('http://x'),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(view.status).toBe(200)
    const data = await view.json()
    expect(data.memberUserIds).toContain(guest.id)
  })

  it('an unknown email is queued as a pending invitation (not 422)', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(owner.idToken)
    const res = await inviteToGroup(
      jsonReq('POST', { email: `pending-${Date.now()}@example.com` }),
      { params: Promise.resolve({ groupId: group.id }) }
    )
    expect(res.status).toBe(201)
    const { resolved } = await res.json()
    expect(resolved).toBe(false)
  })

  it('a non-admin cannot invite', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(stranger.idToken)
    const res = await inviteToGroup(jsonReq('POST', { email: 'x@example.com' }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect([403, 404]).toContain(res.status)
  })

  it('the invitee, not the inviter, can accept', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    const stranger = await makeUser('Stranger')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(owner.idToken)
    const inv = await (await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })).json()

    mockAuth(stranger.idToken)
    const stranged = await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: inv.invitation.id }) })
    expect(stranged.status).toBe(404)
  })
})

describe('group-scoped visibility', () => {
  // Helper: a course owned by `groupId`, scoped to that group's members.
  function groupCourseBody(groupId: string) {
    return {
      name: 'GroupCourse', sport: 'kayak', type: 'point_to_point',
      startLine: [[0, 0], [0, 0.001]], finishLine: [[0.001, 0], [0.001, 0.001]],
      distanceMetres: 100, groupId, visibility: 'group',
    }
  }

  it('a group member can view a course owned by their group (group visibility)', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    // Invite + accept to seed membership.
    mockAuth(owner.idToken)
    const inv = await (await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    mockAuth(guest.idToken)
    await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: inv.invitation.id }) })

    // Owner (group admin) creates a course in the group, scoped to it.
    mockAuth(owner.idToken)
    const course = await (await createCourse(jsonReq('POST', groupCourseBody(group.id)))).json()
    expect(course.visibility).toBe('group')
    expect(course.visibleToGroupId).toBe(group.id)

    // Guest is a member → can see it.
    mockAuth(guest.idToken)
    const memberView = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(memberView.status).toBe(200)

    // A stranger cannot.
    const stranger = await makeUser('Stranger')
    mockAuth(stranger.idToken)
    const strangerView = await getCourse(new NextRequest('http://x'),
      { params: Promise.resolve({ courseId: course.id }) })
    expect(strangerView.status).toBe(404)
  })

  it('a plain member cannot create a course in a group they only belong to (403)', async () => {
    const owner = await makeUser('Owner')
    const member = await makeUser('Member')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(owner.idToken)
    const inv = await (await inviteToGroup(
      jsonReq('POST', { email: member.email, role: 'member' }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    mockAuth(member.idToken)
    await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: inv.invitation.id }) })

    // Creation is gated to owner/admins — a plain member is refused.
    mockAuth(member.idToken)
    const res = await createCourse(jsonReq('POST', groupCourseBody(group.id)))
    expect(res.status).toBe(403)
  })
})

describe('self-serve join (phase 4)', () => {
  async function makeGroupWithPolicy(ownerToken: string, policy: 'invite_only' | 'request' | 'open') {
    mockAuth(ownerToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'G' }))).json()
    if (policy !== 'request') {
      mockAuth(ownerToken)
      await patchGroup(jsonReq('PATCH', { joinPolicy: policy }), { params: Promise.resolve({ groupId: group.id }) })
    }
    return group
  }

  it("request policy: a stranger's request is pending until an admin approves, then they're a member", async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    const group = await makeGroupWithPolicy(owner.idToken, 'request')

    mockAuth(joiner.idToken)
    const reqRes = await requestJoin(jsonReq('POST', {}), { params: Promise.resolve({ groupId: group.id }) })
    expect(reqRes.status).toBe(201)
    expect((await reqRes.json()).status).toBe('pending')

    mockAuth(owner.idToken)
    const list = await (await listJoinReqs(new NextRequest('http://x'), { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(list.requests).toHaveLength(1)
    const reqId = list.requests[0].id

    mockAuth(owner.idToken)
    const appr = await approveJoin(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, requestId: reqId }) })
    expect(appr.status).toBe(200)
    expect((await appr.json()).group.memberUserIds).toContain(joiner.id)
  })

  it('open policy: a stranger joins instantly', async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    const group = await makeGroupWithPolicy(owner.idToken, 'open')

    mockAuth(joiner.idToken)
    const res = await requestJoin(jsonReq('POST', {}), { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('accepted')

    mockAuth(joiner.idToken)
    const g = await (await getGroupRoute(new NextRequest('http://x'), { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(g.memberUserIds).toContain(joiner.id)
  })

  it('invite_only policy: a self-serve request is rejected (403)', async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    const group = await makeGroupWithPolicy(owner.idToken, 'invite_only')

    mockAuth(joiner.idToken)
    const res = await requestJoin(jsonReq('POST', {}), { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(403)
  })

  it('a valid join link lets a stranger join instantly, even on a request-policy group', async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'G' }))).json()
    mockAuth(owner.idToken)
    const patched = await (await patchGroup(jsonReq('PATCH', { regenerateJoinLink: true }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(patched.joinLinkToken).toBeTruthy()

    mockAuth(joiner.idToken)
    const res = await requestJoin(jsonReq('POST', { token: patched.joinLinkToken }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('accepted')
  })

  it('a non-admin cannot approve a join request', async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    const stranger = await makeUser('Stranger')
    const group = await makeGroupWithPolicy(owner.idToken, 'request')

    mockAuth(joiner.idToken)
    const reqId = (await (await requestJoin(jsonReq('POST', {}),
      { params: Promise.resolve({ groupId: group.id }) })).json()).request.id

    mockAuth(stranger.idToken)
    const res = await approveJoin(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, requestId: reqId }) })
    expect(res.status).toBe(403)
  })

  it('an admin can decline a request — the requester does not become a member', async () => {
    const owner = await makeUser('Owner')
    const joiner = await makeUser('Joiner')
    const group = await makeGroupWithPolicy(owner.idToken, 'request')

    mockAuth(joiner.idToken)
    const reqId = (await (await requestJoin(jsonReq('POST', {}),
      { params: Promise.resolve({ groupId: group.id }) })).json()).request.id

    mockAuth(owner.idToken)
    const dec = await declineJoin(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, requestId: reqId }) })
    expect(dec.status).toBe(200)

    mockAuth(owner.idToken)
    const g = await (await getGroupRoute(new NextRequest('http://x'), { params: Promise.resolve({ groupId: group.id }) })).json()
    expect(g.memberUserIds).not.toContain(joiner.id)
  })
})

describe('membership lifecycle', () => {
  it('the owner can kick a member', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(owner.idToken)
    const inv = await (await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    mockAuth(guest.idToken)
    await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: inv.invitation.id }) })

    mockAuth(owner.idToken)
    const res = await kickMember(new NextRequest('http://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: group.id, userId: guest.id }) })
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.group.memberUserIds).not.toContain(guest.id)
  })

  it('a member can leave themselves', async () => {
    const owner = await makeUser('Owner')
    const guest = await makeUser('Guest')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()
    mockAuth(owner.idToken)
    const inv = await (await inviteToGroup(jsonReq('POST', { email: guest.email }),
      { params: Promise.resolve({ groupId: group.id }) })).json()
    mockAuth(guest.idToken)
    await acceptInvite(new NextRequest('http://x', { method: 'POST' }),
      { params: Promise.resolve({ groupId: group.id, invitationId: inv.invitation.id }) })

    mockAuth(guest.idToken)
    const res = await kickMember(new NextRequest('http://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: group.id, userId: guest.id }) })
    expect(res.status).toBe(200)
  })

  it('the owner cannot be kicked from their own group', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(owner.idToken)
    const res = await kickMember(new NextRequest('http://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: group.id, userId: owner.id }) })
    expect(res.status).toBe(400)
  })
})

describe('deleting a group', () => {
  it('the owner can delete', async () => {
    const owner = await makeUser('Owner')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(owner.idToken)
    const res = await deleteGroupRoute(new NextRequest('http://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(res.status).toBe(200)

    mockAuth(owner.idToken)
    const view = await getGroupRoute(new NextRequest('http://x'),
      { params: Promise.resolve({ groupId: group.id }) })
    expect(view.status).toBe(404)
  })

  it('a non-owner cannot delete', async () => {
    const owner = await makeUser('Owner')
    const stranger = await makeUser('Stranger')
    mockAuth(owner.idToken)
    const group = await (await createGroup(jsonReq('POST', { name: 'C' }))).json()

    mockAuth(stranger.idToken)
    const res = await deleteGroupRoute(new NextRequest('http://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: group.id }) })
    expect([403, 404]).toContain(res.status)
  })
})

describe('group directory (#99)', () => {
  async function makeGroupWithPolicy(ownerToken: string, name: string, policy: 'open' | 'request' | 'invite_only') {
    mockAuth(ownerToken)
    const group = await (await createGroup(jsonReq('POST', { name }))).json()
    if (policy !== 'request') {
      mockAuth(ownerToken)
      await patchGroup(jsonReq('PATCH', { joinPolicy: policy }), { params: Promise.resolve({ groupId: group.id }) })
    }
    return group
  }

  it('lists open + request groups as a limited projection, excludes invite_only, works unauthenticated', async () => {
    const owner = await makeUser('Owner')
    await makeGroupWithPolicy(owner.idToken, 'Open Club', 'open')
    await makeGroupWithPolicy(owner.idToken, 'Request Club', 'request')
    await makeGroupWithPolicy(owner.idToken, 'Secret Club', 'invite_only')

    mockAuth(null) // the directory is public
    const res = await listGroups(new NextRequest('http://x/att/api/groups?directory=1'))
    expect(res.status).toBe(200)
    const { groups } = await res.json()
    const names = groups.map((g: { name: string }) => g.name)
    expect(names).toContain('Open Club')
    expect(names).toContain('Request Club')
    expect(names).not.toContain('Secret Club')
    // Limited projection — the member list is never exposed in the directory.
    expect(groups[0].memberUserIds).toBeUndefined()
    expect(groups.find((g: { name: string }) => g.name === 'Open Club').joinPolicy).toBe('open')
  })

  it('flags groups the viewer already belongs to with isMember', async () => {
    const owner = await makeUser('Owner')
    const group = await makeGroupWithPolicy(owner.idToken, 'My Open Club', 'open')

    mockAuth(owner.idToken)
    const res = await listGroups(new NextRequest('http://x/att/api/groups?directory=1'))
    const { groups } = await res.json()
    expect(groups.find((g: { id: string }) => g.id === group.id).isMember).toBe(true)
  })
})
