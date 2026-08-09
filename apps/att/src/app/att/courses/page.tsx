import Link from 'next/link'
import { getJson, listKeys } from '@/lib/storage'
import { getAuthUser } from '@/lib/auth'
import { isListedForViewer } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import AppHeader from '@/components/AppHeader'
import type { CourseMetadata, TrialMetadata, AuthUser } from '@/lib/types'

// Reads live course state from storage on every request — never prerender.
export const dynamic = 'force-dynamic'

type CourseWithCounts = {
  course: CourseMetadata
  trialCount: number
  openCount: number
}

async function getCoursesWithCounts(viewer: AuthUser | null): Promise<CourseWithCounts[]> {
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  const keys = await listKeys('courses/')
  const metaKeys = keys.filter(k => k.endsWith('metadata.json'))
  const courses = (
    await Promise.all(metaKeys.map(k => getJson<CourseMetadata>(k)))
  )
    .filter((c): c is CourseMetadata => c !== null)
    .filter(c => isListedForViewer(c, viewer, viewerGroupIds))

  // Fetch trials once and group by courseId — cheaper than N queries.
  // Counts only include trials the viewer is allowed to see so a public
  // course doesn't surface "5 trials" when 4 are private to another user.
  const trialKeys = await listKeys('trials/')
  const trialMetaKeys = trialKeys.filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const trials = (
    await Promise.all(trialMetaKeys.map(k => getJson<TrialMetadata>(k)))
  )
    .filter((t): t is TrialMetadata => t !== null)
    .filter(t => isListedForViewer(t, viewer, viewerGroupIds))

  return courses
    .map(course => {
      const courseTrials = trials.filter(t => t.courseId === course.id)
      return {
        course,
        trialCount: courseTrials.length,
        openCount: courseTrials.filter(t => t.status === 'open').length,
      }
    })
    .sort((a, b) => b.openCount - a.openCount || a.course.name.localeCompare(b.course.name))
}

function courseTypeLabel(course: CourseMetadata): string {
  if (course.gates && course.gates.length >= 2) return `${course.gates.length}-gate`
  if (course.type === 'loop' || course.type === 'lap' || course.type === 'figure_eight') return 'Loop'
  if (course.type === 'gate' || course.type === 'out_and_back') return 'Gate'
  return 'Point-to-point'
}

export default async function CoursesCataloguePage() {
  const viewer = await getAuthUser()
  const canOrganise = viewer ? (await getUserAdminGroupIds(viewer.id)).size > 0 : false
  const courses = await getCoursesWithCounts(viewer)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att" className="tt-nav-link text-sm">
              ← HOME
            </Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">COURSES</span>
          </>
        }
      >
        {canOrganise ? (
          <Link href="/att/admin/courses/new" className="tt-nav-link">
            + NEW COURSE
          </Link>
        ) : (
          <Link href="/att/groups" className="tt-nav-link">
            + NEW GROUP
          </Link>
        )}
      </AppHeader>

      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full">
        <h1 className="text-lg font-bold text-fg tracking-widest mb-2">COURSE CATALOGUE</h1>
        <p className="text-sm text-muted mb-8">
          Browse all courses. Group admins can open time trials on a course; create a group to organise your own.
        </p>

        {courses.length === 0 ? (
          <div className="border border-border p-8 text-center text-muted text-sm">
            {canOrganise ? (
              <>
                No courses yet.{' '}
                <Link href="/att/admin/courses/new" className="tt-link">Create the first one</Link>.
              </>
            ) : (
              <>
                No courses yet.{' '}
                <Link href="/att/groups" className="tt-link">Create a group</Link> to add one.
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {courses.map(({ course, trialCount, openCount }) => (
              <Link
                key={course.id}
                href={`/att/courses/${course.id}`}
                className="border border-border px-4 py-4 hover:border-primary transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-fg font-bold group-hover:text-primary transition-colors">
                      {course.name}
                    </div>
                    <div className="text-xs text-muted mt-0.5 tabular">
                      {course.sport.toUpperCase()} ·{' '}
                      {course.distanceMetres > 0 ? `${course.distanceMetres.toLocaleString()} m` : '—'} ·{' '}
                      {courseTypeLabel(course)}
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    {openCount > 0 && (
                      <div className="border border-green text-green px-2 py-0.5 mb-1 inline-block">
                        {openCount} OPEN
                      </div>
                    )}
                    <div className="text-muted">
                      {trialCount} trial{trialCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
