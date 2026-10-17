import Link from 'next/link'
import { fmtDay, sportLabel } from '@paddlesnitch/core/format'
import { getJson } from '@/lib/storage'
import { getAuthUser } from '@/lib/auth'
import { isListedForViewer, canManageTrial } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import { getRecentSubmissions } from '@/lib/recent'
import { getPublicProfileLinks } from '@/lib/profile'
import { formatTime } from '@/lib/geo'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Chevron, EmptyState, cardClass } from '@paddlesnitch/ui/Card'
import type { CourseMetadata, AuthUser } from '@/lib/types'
import { listTrials } from '@/lib/catalogue'

// Reads live trial state from storage on every request — never prerender.
// Without this, `next build` tries to fetch from S3 at build time and fails
// when AWS credentials / bucket aren't available in CI.
export const dynamic = 'force-dynamic'

async function getOpenTrials(viewer: AuthUser | null) {
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  const trials = (await listTrials()).filter(t => t.status === 'open')
    .filter(t => isListedForViewer(t, viewer, viewerGroupIds))
    // Order by event date (newest first), tie-broken by creation time — so the
    // list isn't in storage-key (nanoid) order. Matches the createdAt-desc
    // ordering the course-detail trial lists already use (#103). ISO date and
    // timestamp strings sort correctly lexicographically.
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  return Promise.all(
    trials.map(async trial => {
      const course = await getJson<CourseMetadata>(
        `courses/${trial.courseId}/metadata.json`
      )
      return { trial, course }
    })
  )
}

export default async function Home() {
  const viewer = await getAuthUser()
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : new Set<string>()
  // Groups the viewer can manage gate the create UI (phase 2). Empty for
  // paddlers, who see a "create a group" on-ramp instead of create buttons.
  const adminGroupIds = viewer ? await getUserAdminGroupIds(viewer.id) : new Set<string>()
  const canOrganise = adminGroupIds.size > 0
  const [openTrials, recent] = await Promise.all([
    getOpenTrials(viewer),
    getRecentSubmissions(viewer, viewerGroupIds),
  ])
  // Link each recent submitter's name to their profile — only when it's public.
  const profileLinks = Object.fromEntries(
    await getPublicProfileLinks(recent.map(r => r.userId)),
  )

  return (
    <main className="flex-1 flex flex-col">
      {/* Section nav: calm, sentence case. Creating things lives on the page
          that owns it (New trial here for organisers, New group on Groups). */}
      <AppHeader>
        <Link href="/att/courses" className="tt-nav-link text-sm">Courses</Link>
        <Link href="/att/groups" className="tt-nav-link text-sm">Groups</Link>
      </AppHeader>

      <Page>
        <PageHeader
          title="Time trials"
          description="Upload your GPS file from a trial and we time it between the lines, with 500 m splits."
          actions={canOrganise ? (
            <Link href="/att/admin/trials/new" className={buttonClass('primary')}>New trial</Link>
          ) : undefined}
        />

        <Section title="Open trials">
          {openTrials.length === 0 ? (
            <EmptyState
              title="No open trials yet"
              body={canOrganise ? 'Open one on a course your group runs.' : 'Groups run trials for their members. Start one for your club or squad.'}
              action={canOrganise ? (
                <Link href="/att/admin/trials/new" className={buttonClass('primary')}>Open a trial</Link>
              ) : (
                <Link href="/att/groups" className={buttonClass('secondary')}>Create a group</Link>
              )}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {openTrials.map(({ trial, course }) => (
                // The card links to the public trial page. Owners get a
                // separate "Manage" link to the admin page so they can close
                // the trial (#87). Nested anchors are invalid, so the manage
                // link sits outside the card anchor.
                <li key={trial.id} className={`${cardClass} overflow-hidden`}>
                  <a
                    href={`/att/trials/${trial.id}`}
                    className="flex items-center gap-3 px-4 py-4 min-h-11 hover:bg-surface-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold text-fg">{trial.name}</div>
                      <div className="text-sm text-muted mt-0.5">
                        {course?.name ?? 'Unknown course'} · {fmtDay(trial.date)}
                        {course && ` · ${sportLabel(course.sport).toLowerCase()}`}
                      </div>
                    </div>
                    <Chevron />
                  </a>
                  {canManageTrial(trial, viewer, adminGroupIds) && (
                    <div className="border-t border-border px-2 py-1 flex justify-end">
                      <Link href={`/att/admin/trials/${trial.id}`} className={buttonClass('quiet', 'sm')}>
                        Manage or close
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent results">
          {recent.length === 0 ? (
            <p className="text-sm text-muted">No results yet. They show here as people enter.</p>
          ) : (
            <ul className={`${cardClass} divide-y divide-border`}>
              {recent.map(r => (
                <li key={r.entryId} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base text-fg font-medium truncate">
                      {profileLinks[r.userId] ? (
                        <Link href={`/profile/${profileLinks[r.userId]}`} className="hover:text-primary-text hover:underline transition-colors">
                          {r.displayName}
                        </Link>
                      ) : (
                        r.displayName
                      )}
                    </div>
                    <div className="text-sm text-muted mt-0.5 truncate">
                      <Link href={`/att/trials/${r.trialId}`} className="hover:text-primary-text transition-colors">
                        {r.courseName}
                      </Link>{' '}
                      · {fmtDay(r.raceDate)} · {r.boatClass}
                    </div>
                  </div>
                  <span className="text-base tabular font-semibold text-primary-text shrink-0">
                    {formatTime(r.totalElapsedSeconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <nav aria-label="More in Trials" className="flex flex-wrap gap-2 border-t border-border pt-6">
          <Link href="/att/courses" className={buttonClass('quiet')}>Browse all courses</Link>
          <Link href="/att/groups" className={buttonClass('quiet')}>Groups</Link>
          <Link href="/help" className={buttonClass('quiet')}>Help</Link>
        </nav>
      </Page>
    </main>
  )
}
