import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getJson } from '@/lib/storage'
import { resolveEntry, setEntryNote } from '@/lib/entries'
import { stravaActivityIdFromFilename } from '@/lib/leaderboard'
import { canViewTrial } from '@/lib/permissions'
import { getUserGroupIds } from '@/lib/groups'
import type { TrialMetadata, CourseMetadata } from '@/lib/types'

type Params = { params: Promise<{ entryId: string }> }

// GET /att/api/entries/[entryId]
// The single entry, viewable by anyone who can view its trial (same visibility
// rule as the leaderboard). The paddler's private `note` is included ONLY for
// the entry's owner — never for other viewers. 404 (not 403) when the trial
// isn't viewable, so existence isn't leaked.
export async function GET(_: NextRequest, { params }: Params) {
  const { entryId } = await params
  const resolved = await resolveEntry(entryId)
  if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { trialId, entry } = resolved
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  if (!canViewTrial(trial, viewer, viewerGroupIds)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const course = await getJson<CourseMetadata>(`courses/${trial.courseId}/metadata.json`)
  const isOwner = !!viewer && viewer.id === entry.userId

  return NextResponse.json({
    entry: {
      entryId: entry.entryId,
      userId: entry.userId,
      displayName: entry.displayName,
      raceDate: entry.raceDate,
      submittedAt: entry.submittedAt,
      boatClass: entry.boatClass,
      crew: entry.crew,
      totalElapsedSeconds: entry.result.totalElapsedSeconds,
      splits: entry.result.splits,
      ...(entry.result.runCount ? { runCount: entry.result.runCount } : {}),
      ...(entry.result.avgStrokeRate != null ? { avgStrokeRate: entry.result.avgStrokeRate } : {}),
      ...(entry.result.trackSegment ? { trackSegment: entry.result.trackSegment } : {}),
      ...(entry.conditions ? { conditions: entry.conditions } : {}),
      ...(stravaActivityIdFromFilename(entry.filename) !== undefined
        ? { stravaActivityId: stravaActivityIdFromFilename(entry.filename) }
        : {}),
      // Note is private to the owner.
      ...(isOwner ? { note: entry.note ?? '' } : {}),
    },
    isOwner,
    trial: { id: trial.id, name: trial.name, date: trial.date, status: trial.status },
    course: course
      ? { id: course.id, name: course.name, sport: course.sport, distanceMetres: course.distanceMetres, type: course.type, startLine: course.startLine, finishLine: course.finishLine, gates: course.gates }
      : null,
  })
}

// PATCH /att/api/entries/[entryId]   { note }
// Owner-only. Sets (or clears, when empty) the paddler's private note. Returns
// 404 (not 403) to non-owners so an entry's ownership isn't probeable.
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId } = await params
  const resolved = await resolveEntry(entryId)
  if (!resolved || resolved.entry.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : ''
  const updated = await setEntryNote(resolved, note)
  return NextResponse.json({ note: updated.note ?? '' })
}
