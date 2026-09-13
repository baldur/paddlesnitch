import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  listAllGroups,
  newGroup,
  putGroup,
  getUserGroupIds,
  getUserAdminGroupIds,
  joinPolicyOf,
  addUserToGroupIndex,
} from '@/lib/groups'

// GET /att/api/groups[?role=admin | ?directory=1]
// Default: groups the viewer is in (owner / admin / member). `?role=admin`
// narrows to groups the viewer can MANAGE (course form's group selector).
// `?directory=1` returns the PUBLIC group directory (#99): every group whose
// joinPolicy is open or request, as a LIMITED projection (no member list) so a
// paddler can find a group to join. invite-only groups are omitted — that's the
// lever an owner uses to keep a group out of the directory. Works unauthenticated.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const viewer = await getAuthUser()

  if (searchParams.get('directory') === '1') {
    const viewerIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : new Set<string>()
    const all = await listAllGroups()
    const groups = all
      .filter(g => joinPolicyOf(g) !== 'invite_only')
      .map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        joinPolicy: joinPolicyOf(g),
        memberCount: 1 + g.adminUserIds.length + g.memberUserIds.length,
        isMember: viewerIds.has(g.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ groups })
  }

  if (!viewer) return NextResponse.json({ groups: [] })
  const ids = searchParams.get('role') === 'admin'
    ? await getUserAdminGroupIds(viewer.id)
    : new Set(await getUserGroupIds(viewer.id))
  const all = await listAllGroups()
  return NextResponse.json({ groups: all.filter(c => ids.has(c.id)) })
}

// POST /att/api/groups  { name, description? }
// Any signed-in user can create a group. The creator becomes the owner.
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const description = typeof body.description === 'string' ? body.description : ''

  const group = newGroup({ name, description, ownerId: user.id })
  await putGroup(group)
  await addUserToGroupIndex(user.id, group.id)
  return NextResponse.json(group, { status: 201 })
}
