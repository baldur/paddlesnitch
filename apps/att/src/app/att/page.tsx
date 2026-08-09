import Link from 'next/link'
import { getJson, listKeys } from '@/lib/storage'
import { getAuthUser } from '@/lib/auth'
import { isListedForViewer, canManageTrial } from '@/lib/permissions'
import { getUserGroupIds, getUserAdminGroupIds } from '@/lib/groups'
import { getRecentSubmissions } from '@/lib/recent'
import { getPublicProfileLinks } from '@/lib/profile'
import { formatTime } from '@/lib/geo'
import AppHeader from '@/components/AppHeader'
import type { TrialMetadata, CourseMetadata, AuthUser } from '@/lib/types'

// Reads live trial state from storage on every request — never prerender.
// Without this, `next build` tries to fetch from S3 at build time and fails
// when AWS credentials / bucket aren't available in CI.
export const dynamic = 'force-dynamic'

async function getOpenTrials(viewer: AuthUser | null) {
  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : undefined
  const keys = await listKeys('trials/')
  const metaKeys = keys.filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/')
  )
  const trials = (
    await Promise.all(metaKeys.map(k => getJson<TrialMetadata>(k)))
  ).filter((t): t is TrialMetadata => t !== null && t.status === 'open')
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
      <AppHeader
        breadcrumb={
          <>
            <span className="text-fg font-bold text-lg tracking-widest">ATT</span>
            <span className="text-muted text-xs tracking-widest hidden sm:inline">paddlesnitch.com</span>
          </>
        }
      >
        <Link href="/att/courses" className="tt-nav-link">
          COURSES
        </Link>
        <Link href="/att/groups" className="tt-nav-link">
          GROUPS
        </Link>
        {canOrganise ? (
          <Link href="/att/admin/trials/new" className="tt-nav-link">
            + NEW TRIAL
          </Link>
        ) : (
          <Link href="/att/groups" className="tt-nav-link">
            + NEW GROUP
          </Link>
        )}
      </AppHeader>

      <section className="border-b border-border px-4 py-12 text-center bg-surface">
        <p className="text-muted text-xs tracking-[0.3em] uppercase mb-3">
          GPS-verified river racing
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-fg mb-2">
          Automated Time Trials
        </h1>
        <p className="text-muted text-sm">Upload your trace. See your splits.</p>
      </section>

      <section className="flex-1 px-4 py-8 max-w-5xl mx-auto w-full">
        {/* Two columns side-by-side on desktop; stacked on portrait / phones. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Open trials */}
          <div>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-6">
              Open Time Trials
            </h2>
            {openTrials.length === 0 ? (
              <div className="border border-border p-8 text-center text-muted text-sm">
                {canOrganise ? (
                  <>
                    No open trials yet.{' '}
                    <Link href="/att/admin/trials/new" className="tt-link">
                      Open a trial
                    </Link>{' '}
                    to get started.
                  </>
                ) : (
                  <>
                    No open trials yet.{' '}
                    <Link href="/att/groups" className="tt-link">
                      Create a group
                    </Link>{' '}
                    to run your own.
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {openTrials.map(({ trial, course }) => (
                  // The card itself links to the public trial page. Owners get
                  // a separate "manage" link to the admin page so they can
                  // close the trial — the close control lives there and was
                  // otherwise unreachable from this listing (#87). Nested
                  // anchors are invalid, so the manage link sits outside the
                  // card anchor rather than inside it.
                  <div
                    key={trial.id}
                    className="border border-border hover:border-primary transition-colors"
                  >
                    <a
                      href={`/att/trials/${trial.id}`}
                      className="px-4 py-4 flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-fg font-bold group-hover:text-primary transition-colors">
                          {trial.name}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {course?.name ?? 'Unknown course'} · {trial.date}
                          {course && ` · ${course.sport}`}
                        </div>
                      </div>
                      <span className="text-xs border border-green text-green px-2 py-0.5">
                        OPEN
                      </span>
                    </a>
                    {canManageTrial(trial, viewer, adminGroupIds) && (
                      <div className="border-t border-border px-4 py-2 flex justify-end">
                        <Link
                          href={`/att/admin/trials/${trial.id}`}
                          className="text-xs text-muted hover:text-primary tracking-widest transition-colors"
                        >
                          MANAGE / CLOSE →
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent submissions */}
          <div>
            <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-6">
              Recent Submissions
            </h2>
            {recent.length === 0 ? (
              <div className="border border-border p-8 text-center text-muted text-sm">
                No submissions yet.
              </div>
            ) : (
              <ul className="border border-border divide-y divide-surface-2">
                {recent.map(r => (
                  <li key={r.entryId} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-fg font-medium truncate">
                        {profileLinks[r.userId] ? (
                          <Link href={`/profile/${profileLinks[r.userId]}`} className="hover:text-primary hover:underline transition-colors">
                            {r.displayName}
                          </Link>
                        ) : (
                          r.displayName
                        )}
                      </div>
                      <div className="text-xs text-muted mt-0.5 truncate">
                        <Link href={`/att/trials/${r.trialId}`} className="hover:text-primary transition-colors">
                          {r.courseName}
                        </Link>{' '}
                        · {r.raceDate} · {r.boatClass}
                      </div>
                    </div>
                    <span className="text-sm tabular font-bold text-primary shrink-0">
                      {formatTime(r.totalElapsedSeconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-10 flex items-center justify-center gap-6">
          <Link href="/att/courses" className="tt-nav-link text-xs tracking-widest">
            BROWSE ALL COURSES →
          </Link>
          <Link href="/att/faq" className="tt-nav-link text-xs tracking-widest">
            HELP / FAQ
          </Link>
        </div>
      </section>
    </main>
  )
}
