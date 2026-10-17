import Link from 'next/link'
import { fmtDay, sportLabel } from '@paddlesnitch/core/format'
import { notFound } from 'next/navigation'
import { getJson } from '@/lib/storage'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section, eyebrowClass } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Badge, Chevron, EmptyState, cardLinkClass } from '@paddlesnitch/ui/Card'
import CourseMapClient from '@/components/map/CourseMapClient'
import { getAuthUser } from '@/lib/auth'
import { canViewCourse, canManageCourse, isListedForViewer } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import type { CourseMetadata, LeaderboardEntry } from '@/lib/types'
import { courseRecords } from '@/lib/course-records'
import { formatTime } from '@/lib/geo'
import { listTrials } from '@/lib/catalogue'

export const dynamic = 'force-dynamic'

const sportName = sportLabel

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params

  const course = await getJson<CourseMetadata>(`courses/${courseId}/metadata.json`)
  if (!course) notFound()
  const user = await getAuthUser()
  // Private courses 404 to non-owners; group-scoped courses 404 unless the
  // viewer is in the group. Single 404 keeps existence private.
  const viewerGroupIds = user ? new Set(await getUserGroupIds(user.id)) : undefined
  if (!canViewCourse(course, user, viewerGroupIds)) notFound()

  const trials = (await listTrials()).filter(t => t.courseId === courseId)
    // Only surface trials the viewer is allowed to see — so a private
    // trial on a public course doesn't leak through the course detail
    // page.
    .filter(t => isListedForViewer(t, user, viewerGroupIds))

  const sortedTrials = [...trials].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Course records: the fastest result per boat class, from the trials above
  // (so only results the viewer may already see on those leaderboards).
  const records = courseRecords(await Promise.all(sortedTrials.map(async t => ({
    trialId: t.id, entries: (await getJson<LeaderboardEntry[]>(`trials/${t.id}/leaderboard.json`)) ?? [],
  }))))

  // Manage (edit course / open trials on it) belongs to the owning group's
  // admins (phase 2), not just the original creator.
  const adminGroupIds = user ? await getUserAdminGroupIds(user.id) : undefined
  const canManage = canManageCourse(course, user, adminGroupIds)

  // The main action: enter the newest open trial on this course.
  const openTrial = sortedTrials.find(t => t.status === 'open')

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href="/att/courses" className="tt-nav-link">← Courses</Link>}
      />

      <Page>
        <PageHeader
          title={course.name}
          description={
            <>
              {sportName(course.sport)} · <span className="tabular">{course.distanceMetres.toLocaleString()} m</span>
              {course.type === 'loop' && ' · loop'}
            </>
          }
          actions={
            <>
              {openTrial && (
                <a href={`/att/trials/${openTrial.id}/upload`} className={buttonClass('primary')}>
                  Enter this trial
                </a>
              )}
              {canManage && (
                <Link href={`/att/admin/courses/${course.id}`} className={buttonClass('secondary')}>
                  Edit course
                </Link>
              )}
            </>
          }
        />

        <CourseMapClient course={course} />

        <Section
          title="Trials"
          actions={canManage ? (
            <Link href={`/att/admin/trials/new?courseId=${course.id}`} className={buttonClass('secondary', 'sm')}>
              New trial
            </Link>
          ) : undefined}
        >
          {sortedTrials.length === 0 ? (
            <EmptyState
              title="No trials on this course yet"
              action={canManage ? (
                <Link href={`/att/admin/trials/new?courseId=${course.id}`} className={buttonClass('primary')}>
                  Open the first one
                </Link>
              ) : undefined}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {sortedTrials.map(t => (
                <li key={t.id}>
                  <Link
                    href={`/att/trials/${t.id}`}
                    className={`${cardLinkClass} flex items-center gap-3 px-4 py-3 min-h-11`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium text-fg">{t.name}</div>
                      <div className="text-sm text-muted mt-0.5">{fmtDay(t.date)}</div>
                    </div>
                    <Badge tone={t.status === 'open' ? 'green' : 'neutral'}>
                      {t.status === 'open' ? 'Open' : 'Closed'}
                    </Badge>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {records.length > 0 && (
          <Section title="Course records">
            <div className="overflow-x-auto" aria-label="Course records">
              <table className="w-full text-sm tabular">
                <thead>
                  <tr className={eyebrowClass}>
                    <th className="text-left font-normal py-2 pr-3">Class</th>
                    <th className="text-left font-normal py-2 pr-3">Time</th>
                    <th className="text-left font-normal py-2 pr-3">Paddler</th>
                    <th className="text-right font-normal py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.boatClass} className="border-t border-border">
                      <td className="py-2 pr-3 text-muted w-12">{r.boatClass}</td>
                      <td className="py-2 pr-3"><Link href={`/att/entries/${r.entryId}`} className="text-primary-text font-semibold hover:underline">{formatTime(r.seconds)}</Link></td>
                      <td className="py-2 pr-3 text-fg break-words font-sans">{r.displayName}</td>
                      <td className="py-2 text-muted text-right whitespace-nowrap">{fmtDay(r.raceDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </Page>
    </main>
  )
}
