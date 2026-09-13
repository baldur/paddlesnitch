import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getJson, listKeys } from '@/lib/storage'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'

// GDPR Art. 15 (right of access) + Art. 20 (right to data portability) endpoint.
// Returns a JSON document containing everything the system holds about the
// signed-in user. Marked as a downloadable attachment so the browser triggers
// a save dialog.
export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Courses the user owns.
  const courseKeys = (await listKeys('courses/')).filter(k => k.endsWith('metadata.json'))
  const allCourses = await Promise.all(courseKeys.map(k => getJson<CourseMetadata>(k)))
  const ownedCourses = allCourses
    .filter((c): c is CourseMetadata => c !== null && c.adminUserId === user.id)

  // Trials the user owns.
  const trialKeys = (await listKeys('trials/')).filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const allTrials = await Promise.all(trialKeys.map(k => getJson<TrialMetadata>(k)))
  const ownedTrials = allTrials
    .filter((t): t is TrialMetadata => t !== null && t.adminUserId === user.id)

  // Entries the user submitted (in any trial — owned or not). The entry path
  // includes the user's id, so we can target the listing directly.
  const entryKeys = (await listKeys(`trials/`))
    .filter(k => k.endsWith('result.json') && k.includes(`/entries/${user.id}/`))
  const submittedEntries = (await Promise.all(entryKeys.map(k => getJson(k))))
    .filter((e): e is Record<string, unknown> => e !== null)

  // Failed uploads the user submitted — GPS tracks of traces that didn't match
  // a course, retained for debugging. Same id-scoped path as entries.
  const failedKeys = (await listKeys(`trials/`))
    .filter(k => k.endsWith('diagnostic.json') && k.includes(`/failed-uploads/${user.id}/`))
  const failedUploads = (await Promise.all(failedKeys.map(k => getJson(k))))
    .filter((e): e is Record<string, unknown> => e !== null)

  const body = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    ownedCourses,
    ownedTrials,
    submittedEntries,
    failedUploads,
    notes: [
      'This file contains all personal data paddlesnitch.com holds about you.',
      'Heart rate and cadence are intentionally never collected — see the privacy policy.',
      'Passwords are held by Amazon Cognito and are never exposed via this export.',
    ],
  }

  const filename = `paddlesnitch-data-${user.id}-${new Date().toISOString().slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
