import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@/lib/auth'
import { getJson, putJson, listKeys } from '@/lib/storage'
import { isListedForViewer, canCreateCourseInGroup, canManageCourse } from '@/lib/permissions'
import { getGroup, getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import type { CourseMetadata, Visibility } from '@/lib/types'

function isVisibility(v: unknown): v is Visibility {
  return v === 'public' || v === 'private' || v === 'group'
}

// GET /att/api/courses[?manageable=1]
// Default: every course the viewer may see. With `?manageable=1` it narrows to
// courses the viewer can MANAGE (owns/admins the course's group) — used by the
// trial form, since opening a trial requires managing the course's group.
export async function GET(req: NextRequest) {
  const viewer = await getAuthUser()
  const { searchParams } = new URL(req.url)
  const manageableOnly = searchParams.get('manageable') === '1'
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  const keys = await listKeys('courses/')
  const metaKeys = keys.filter(k => k.endsWith('metadata.json'))
  const courses = (
    await Promise.all(metaKeys.map(k => getJson<CourseMetadata>(k)))
  ).filter((c): c is CourseMetadata => !!c)

  if (manageableOnly) {
    if (!viewer) return NextResponse.json([])
    const adminGroupIds = await getUserAdminGroupIds(viewer.id)
    return NextResponse.json(courses.filter(c => canManageCourse(c, viewer, adminGroupIds)))
  }
  return NextResponse.json(courses.filter(c => isListedForViewer(c, viewer, viewerGroupIds)))
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, sport, type = 'point_to_point', startLine, finishLine, distanceMetres, minValidSeconds, gateDirection, gates, visibility, groupId } = body
  const hasGates = type === 'gate' && Array.isArray(gates) && gates.length >= 2
  if (!name || !sport || (!startLine && !hasGates)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if ((type === 'point_to_point' || type === 'one_way') && !finishLine) {
    return NextResponse.json({ error: 'Point-to-point courses require a finish line' }, { status: 400 })
  }
  if (type === 'gate' && (!gates || gates.length < 2)) {
    return NextResponse.json({ error: 'Gate courses require at least 2 gates' }, { status: 400 })
  }

  // Creation is gated to group owners/admins (phase 2). Every course belongs to
  // a group the creator manages; paddlers with no group can't create one.
  if (typeof groupId !== 'string' || !groupId) {
    return NextResponse.json(
      { error: 'A course must belong to a group you manage.', code: 'group_required' },
      { status: 400 },
    )
  }
  const group = await getGroup(groupId)
  if (!group || !canCreateCourseInGroup(group, user)) {
    return NextResponse.json(
      { error: 'You can only create courses in a group you own or administer.', code: 'not_group_admin' },
      { status: 403 },
    )
  }

  // 'group' visibility scopes the course to its owning group — there's no
  // separate scope-to-another-group concept (ownership and group-visibility are
  // the same group).
  const resolvedVisibility: Visibility = isVisibility(visibility) ? visibility : 'public'
  const visibleToGroupId = resolvedVisibility === 'group' ? groupId : undefined

  // For gate courses derive startLine/finishLine/gateDirection from the gates array
  const resolvedStartLine = type === 'gate' && gates ? gates[0].line : startLine
  const resolvedFinishLine = type === 'gate' && gates ? gates[gates.length - 1].line : (type === 'loop' ? undefined : finishLine)
  const resolvedGateDirection = type === 'gate' && gates ? gates[0].direction : (gateDirection ?? undefined)

  const id = nanoid()
  const course: CourseMetadata = {
    id,
    name,
    sport,
    type,
    startLine: resolvedStartLine,
    finishLine: resolvedFinishLine,
    distanceMetres: Number(distanceMetres ?? 0),
    ...(minValidSeconds ? { minValidSeconds: Number(minValidSeconds) } : {}),
    ...(resolvedGateDirection != null ? { gateDirection: Number(resolvedGateDirection) as 1 | -1 } : {}),
    ...(type === 'gate' && gates ? { gates } : {}),
    groupId,
    adminUserId: user.id,
    visibility: resolvedVisibility,
    ...(visibleToGroupId ? { visibleToGroupId } : {}),
    createdAt: new Date().toISOString(),
  }
  await putJson(`courses/${id}/metadata.json`, course)
  return NextResponse.json(course, { status: 201 })
}
