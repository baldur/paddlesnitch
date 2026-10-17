import Link from 'next/link'
import { sportLabel } from '@paddlesnitch/core/format'
import { getAuthUser } from '@/lib/auth'
import { isListedForViewer } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Badge, Chevron, EmptyState, cardLinkClass } from '@paddlesnitch/ui/Card'
import type { CourseMetadata, AuthUser } from '@/lib/types'
import { listTrials, listCourses } from '@/lib/catalogue'

// Reads live course state from storage on every request — never prerender.
export const dynamic = 'force-dynamic'

type CourseWithCounts = {
  course: CourseMetadata
  trialCount: number
  openCount: number
}

async function getCoursesWithCounts(viewer: AuthUser | null): Promise<CourseWithCounts[]> {
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  const courses = (await listCourses()).filter(c => isListedForViewer(c, viewer, viewerGroupIds))

  // Fetch trials once and group by courseId — cheaper than N queries.
  // Counts only include trials the viewer is allowed to see so a public
  // course doesn't surface "5 trials" when 4 are private to another user.
  const trials = (await listTrials()).filter(t => isListedForViewer(t, viewer, viewerGroupIds))

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

const sportName = sportLabel

export default async function CoursesCataloguePage() {
  const viewer = await getAuthUser()
  const canOrganise = viewer ? (await getUserAdminGroupIds(viewer.id)).size > 0 : false
  const courses = await getCoursesWithCounts(viewer)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href="/att" className="tt-nav-link">← Trials</Link>}
      />

      <Page>
        <PageHeader
          title="Courses"
          description="Every course you can see. Groups draw courses and run trials on them."
          actions={canOrganise ? (
            <Link href="/att/admin/courses/new" className={buttonClass('primary')}>New course</Link>
          ) : undefined}
        />

        {courses.length === 0 ? (
          <EmptyState
            title="No courses yet"
            body={canOrganise ? undefined : 'Courses belong to groups. Create a group to draw one.'}
            action={canOrganise ? (
              <Link href="/att/admin/courses/new" className={buttonClass('primary')}>New course</Link>
            ) : viewer ? (
              <Link href="/att/groups" className={buttonClass('secondary')}>Create a group</Link>
            ) : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {courses.map(({ course, trialCount, openCount }) => (
              <li key={course.id}>
                <Link
                  href={`/att/courses/${course.id}`}
                  className={`${cardLinkClass} flex items-center gap-3 px-4 py-4`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-fg">{course.name}</div>
                    <div className="text-sm text-muted mt-0.5">
                      {sportName(course.sport)} ·{' '}
                      <span className="tabular">{course.distanceMetres > 0 ? `${course.distanceMetres.toLocaleString()} m` : '—'}</span> ·{' '}
                      {courseTypeLabel(course)}
                    </div>
                    <div className="text-sm text-muted mt-0.5 tabular">
                      {trialCount} trial{trialCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  {openCount > 0 && <Badge tone="green">{openCount} open</Badge>}
                  <Chevron />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </main>
  )
}
