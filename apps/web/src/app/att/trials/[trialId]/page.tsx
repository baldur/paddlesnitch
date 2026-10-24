import Link from 'next/link'
import { fmtDay, sportLabel } from '@paddlesnitch/core/format'
import { notFound } from 'next/navigation'
import { getJson } from '@/lib/storage'
import { getAuthUser } from '@/lib/auth'
import { canViewTrial } from '@/lib/permissions'
import { getUserGroupIds } from '@/lib/groups'
import { getPublicProfileLinks } from '@/lib/profile'
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable'
import { resultMarks } from '@/lib/course-records'
import CourseMapClient from '@/components/map/CourseMapClient'
import { courseLinesText } from '@/lib/course-text'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Badge } from '@paddlesnitch/ui/Card'
import type { TrialMetadata, CourseMetadata, LeaderboardEntry, ProcessedResult } from '@/lib/types'
import { listTrials } from '@/lib/catalogue'
import { trialJsonLd } from '@/lib/discovery'

type StoredEntry = { result: ProcessedResult }

const sportName = sportLabel

export default async function TrialPage({
  params,
}: {
  params: Promise<{ trialId: string }>
}) {
  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) notFound()
  // Hide existence of private trials. Anyone who can't view gets the same
  // 404 as a missing trial — no leakage of "this trial exists but you can't
  // see it" through differing copy.
  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  if (!canViewTrial(trial, viewer, viewerGroupIds)) notFound()

  const [course, leaderboard] = await Promise.all([
    getJson<CourseMetadata>(`courses/${trial.courseId}/metadata.json`),
    getJson<LeaderboardEntry[]>(`trials/${trialId}/leaderboard.json`),
  ])

  const winner = leaderboard?.[0]
  const winnerEntry = winner
    ? await getJson<StoredEntry>(`trials/${trialId}/entries/${winner.userId}/${winner.entryId}/result.json`)
    : null
  const winnerTrack = winnerEntry?.result.trackSegment

  // COURSE RECORD and PB marks, from every result on this course the viewer
  // may see (the same rule as this leaderboard: canViewTrial).
  const sameCourse = (await listTrials()).filter(t => t.courseId === trial.courseId && canViewTrial(t, viewer, viewerGroupIds))
  const marks = resultMarks(await Promise.all(sameCourse.map(async t => ({
    trialId: t.id, entries: t.id === trialId ? (leaderboard ?? []) : ((await getJson<LeaderboardEntry[]>(`trials/${t.id}/leaderboard.json`)) ?? []),
  }))))

  // Link each athlete's name to their profile — but only for paddlers whose
  // profile is public (opt-in), so private profiles never become dead links.
  const profileLinks = Object.fromEntries(
    await getPublicProfileLinks((leaderboard ?? []).map(e => e.userId)),
  )

  const jsonLd = trialJsonLd(trial, course)

  return (
    <main className="flex-1 flex flex-col">
      {/* What, when and where, for search engines and assistants (#513). Escaped so a name can't close the script. */}
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />}
      <AppHeader
        breadcrumb={<Link href="/att" className="tt-nav-link">← Trials</Link>}
      />

      <Page>
        <PageHeader
          eyebrow={course ? <Link href={`/att/courses/${course.id}`} className="hover:text-primary-text">{course.name}</Link> : undefined}
          title={trial.name}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{fmtDay(trial.date)}</span>
              {course && (
                <span>
                  {sportName(course.sport)} · <span className="tabular">{course.distanceMetres.toLocaleString()} m</span>
                </span>
              )}
              <Badge tone={trial.status === 'open' ? 'green' : 'neutral'}>
                {trial.status === 'open' ? 'Open' : 'Closed'}
              </Badge>
            </span>
          }
          actions={trial.status === 'open' ? (
            <a href={`/att/trials/${trialId}/upload`} className={buttonClass('primary')}>
              Submit your entry
            </a>
          ) : undefined}
        />

        <Section title="Leaderboard">
          <LeaderboardTable
            entries={leaderboard ?? []}
            uploadHref={trial.status === 'open' ? `/att/trials/${trialId}/upload` : undefined}
            profileLinks={profileLinks}
            marks={marks}
          />
        </Section>

        {course && (
          <Section title="Course">
            <CourseMapClient course={course} track={winnerTrack} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-green" />
                {course.finishLine ? 'Start' : 'Crossing line'}
              </span>
              {course.finishLine && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 bg-red" />
                  Finish
                </span>
              )}
              {winnerTrack && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 bg-primary" />
                  Leader&apos;s track
                </span>
              )}
            </div>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer py-3">The course lines as text</summary>
              <ul className="mt-1 space-y-1 tabular">
                {courseLinesText(course).map(t => <li key={t}>{t}</li>)}
              </ul>
            </details>
          </Section>
        )}
      </Page>
    </main>
  )
}
