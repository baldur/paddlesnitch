import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getAuthUser } from '@/lib/auth'
import { getJson, putJson, listKeys } from '@/lib/storage'
import { canViewCourse, canManageCourse, isListedForViewer } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import type { TrialMetadata, CourseMetadata, Visibility, Participation } from '@/lib/types'

function isVisibility(v: unknown): v is Visibility {
  return v === 'public' || v === 'private' || v === 'group'
}

function isParticipation(v: unknown): v is Participation {
  return v === 'members' || v === 'invitational' || v === 'public'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const courseId = searchParams.get('courseId')
  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined

  const keys = await listKeys('trials/')
  const metaKeys = keys.filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const all = (
    await Promise.all(metaKeys.map(k => getJson<TrialMetadata>(k)))
  ).filter((t): t is TrialMetadata => t !== null)

  const scoped = courseId ? all.filter(t => t.courseId === courseId) : all
  return NextResponse.json(scoped.filter(t => isListedForViewer(t, viewer, viewerGroupIds)))
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { courseId, name, date, visibility, participation } = body
  if (!courseId || !name || !date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const course = await getJson<CourseMetadata>(`courses/${courseId}/metadata.json`)
  const viewerGroupIds = new Set(await getUserGroupIds(user.id))
  if (!course || !canViewCourse(course, user, viewerGroupIds)) {
    // Hide existence of private courses from non-viewers. A non-viewer trying
    // to attach a trial to someone else's private course gets the same
    // "not found" they'd get if the course really didn't exist.
    return NextResponse.json({ error: 'Course not found' }, { status: 404 })
  }

  // Creation is gated (phase 2): a trial inherits its course's group, so only
  // owners/admins of that group can open a trial on the course. A viewer who
  // can SEE the course but doesn't manage its group is told they can't.
  const adminGroupIds = await getUserAdminGroupIds(user.id)
  if (!canManageCourse(course, user, adminGroupIds)) {
    return NextResponse.json(
      { error: 'Only owners or admins of this course’s group can open a trial on it.', code: 'not_group_admin' },
      { status: 403 },
    )
  }

  // Resolve visibility, clamped to the course's scope (a trial can never be
  // wider than its course). The trial's group is always the course's group.
  let resolvedVisibility: Visibility = isVisibility(visibility) ? visibility : 'public'
  let visibleToGroupId: string | undefined
  if (course.visibility === 'private') {
    resolvedVisibility = 'private'
  } else if (course.visibility === 'group') {
    resolvedVisibility = 'group'
    visibleToGroupId = course.visibleToGroupId
  } else if (resolvedVisibility === 'group') {
    // Group-scoped trial on a public course → scope to the owning group.
    if (course.groupId) {
      visibleToGroupId = course.groupId
    } else {
      resolvedVisibility = 'private'
    }
  }

  const id = nanoid()
  const trial: TrialMetadata = {
    id,
    courseId,
    name,
    date,
    status: 'open',
    ...(course.groupId ? { groupId: course.groupId } : {}),
    adminUserId: user.id,
    visibility: resolvedVisibility,
    ...(visibleToGroupId ? { visibleToGroupId } : {}),
    participation: isParticipation(participation) ? participation : 'members',
    invitedUserIds: [],
    createdAt: new Date().toISOString(),
  }
  await putJson(`trials/${id}/metadata.json`, trial)
  return NextResponse.json(trial, { status: 201 })
}
