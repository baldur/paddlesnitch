import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getJson, listKeys } from '@/lib/storage'
import AppHeader from '@/components/AppHeader'
import CourseMapClient from '@/components/map/CourseMapClient'
import { getAuthUser } from '@/lib/auth'
import { canViewCourse, canManageCourse, isListedForViewer } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'

export const dynamic = 'force-dynamic'

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

  const trialKeys = await listKeys('trials/')
  const trialMetaKeys = trialKeys.filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const trials = (
    await Promise.all(trialMetaKeys.map(k => getJson<TrialMetadata>(k)))
  ).filter((t): t is TrialMetadata => t !== null && t.courseId === courseId)
    // Only surface trials the viewer is allowed to see — so a private
    // trial on a public course doesn't leak through the course detail
    // page.
    .filter(t => isListedForViewer(t, user, viewerGroupIds))

  const sortedTrials = [...trials].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Manage (edit course / open trials on it) belongs to the owning group's
  // admins (phase 2), not just the original creator.
  const adminGroupIds = user ? await getUserAdminGroupIds(user.id) : undefined
  const canManage = canManageCourse(course, user, adminGroupIds)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/att/courses" className="tt-nav-link text-sm shrink-0">
              ← COURSES
            </Link>
            <span className="text-muted shrink-0">/</span>
            <span className="text-fg text-sm truncate">{course.name.toUpperCase()}</span>
          </>
        }
      >
        {canManage && (
          <Link href={`/att/admin/courses/${course.id}`} className="tt-nav-link">
            EDIT
          </Link>
        )}
      </AppHeader>

      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-10">
        <section>
          <h1 className="text-lg font-bold text-fg tracking-widest mb-1">
            {course.name.toUpperCase()}
          </h1>
          <p className="text-xs text-muted mb-4">
            {course.sport.toUpperCase()} · {course.distanceMetres.toLocaleString()} M
            {course.type === 'loop' && ' · LOOP'}
          </p>
          <CourseMapClient course={course} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase">
              Time Trials
            </h2>
            {canManage && (
              <Link
                href={`/att/admin/trials/new?courseId=${course.id}`}
                className="text-xs tt-link tracking-widest"
              >
                + NEW TRIAL
              </Link>
            )}
          </div>
          {sortedTrials.length === 0 ? (
            <div className="border border-border p-6 text-center text-muted text-sm">
              No trials on this course yet.
              {canManage && (
                <>
                  {' '}
                  <Link href={`/att/admin/trials/new?courseId=${course.id}`} className="tt-link">
                    Open the first one
                  </Link>
                  .
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedTrials.map(t => (
                <Link
                  key={t.id}
                  href={`/att/trials/${t.id}`}
                  className="border border-border px-4 py-3 flex items-center justify-between hover:border-primary transition-colors group"
                >
                  <div>
                    <div className="text-fg text-sm group-hover:text-primary transition-colors">
                      {t.name}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{t.date}</div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 border ${
                      t.status === 'open'
                        ? 'border-green text-green'
                        : 'border-muted text-muted'
                    }`}
                  >
                    {t.status.toUpperCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
