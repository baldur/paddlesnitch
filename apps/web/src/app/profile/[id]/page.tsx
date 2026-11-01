import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { getUserGroupIds } from '@/lib/groups'
import { getProfileSettings, buildProfileStats, resolveToUserId } from '@/lib/profile'
import { formatTime } from '@/lib/geo'
import { paceFor500m, speedKmh } from '@/lib/format'
import AppHeader from '@/components/AppHeader'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'
import { split500 } from '@paddlesnitch/analysis/analysis'
import { paddlingSummary, groupSameOuting } from '@paddlesnitch/core/paddles'
import { fmtDay, fmtMonth } from '@paddlesnitch/core/format'
import BuddyButton from '@/components/BuddyButton'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Card, Stat, EmptyState, cardClass } from '@paddlesnitch/ui/Card'

// A figure in its own card. Values stay on one line; the grid gives each
// enough room on a phone.
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="min-w-0">
      <Stat label={label} value={<span className="whitespace-nowrap">{value}</span>} />
    </Card>
  )
}

function fmtKm(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`
}

function fmtMonthYear(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  return isNaN(d.getTime()) ? '—' : fmtMonth(d.toISOString())
}

export default async function ProfilePage({
  params,
}: {
  // The dynamic segment is a handle OR a userId.
  params: Promise<{ id: string }>
}) {
  const { id: segment } = await params
  // A claimed handle resolves to its owner; otherwise the segment is a userId.
  const userId = await resolveToUserId(segment)
  const viewer = await getAuthUser()
  const isOwner = viewer?.id === userId

  // Opt-in: a private profile is invisible to everyone but its owner. Same 404
  // as a missing user — no "exists but private" leak.
  const settings = await getProfileSettings(userId)
  if (!settings.public && !isOwner) notFound()

  // Canonical URL: if the user has a handle and they were reached some other way
  // (by userId, or a different-cased handle), redirect to /profile/{handle}.
  if (settings.handle && segment !== settings.handle) {
    redirect(`/profile/${settings.handle}`)
  }

  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : new Set<string>()
  const stats = await buildProfileStats(userId, viewer, viewerGroupIds)

  // Your paddling: from Paddles, so a tracker tester without races doesn't
  // see an empty page. Paddles are private, so it's computed for the owner
  // only, whatever the profile's setting. One outing recorded twice (say, a
  // tracker and a watch file) counts once.
  const ownPaddles = isOwner ? groupSameOuting(await listSessionSummaries(userId).catch(() => [])).map(g => g.lead) : []
  const paddling = ownPaddles.length ? paddlingSummary(ownPaddles, new Date()) : null

  const name = stats.displayName ?? (isOwner ? viewer!.displayName : 'Paddler')

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />

      <Page>
        <PageHeader
          title={name}
          description="Paddler profile"
          actions={
            isOwner
              ? <Link href="/account#profile" className={buttonClass('secondary')}>Edit profile</Link>
              : viewer ? <BuddyButton userId={userId} /> : undefined
          }
        />

        {isOwner && !settings.public && (
          <p className="rounded-control border border-primary/50 bg-primary/10 px-4 py-3 text-sm text-fg -mt-4">
            Only you can see this profile. Make it public in{' '}
            <Link href="/account#profile" className="tt-link">Account</Link> to share it.
          </p>
        )}

        {/* Your paddling: from Paddles, so a tracker tester without races
            doesn't see an empty page. Paddles are private, so this part is
            for the owner only, whatever the profile's setting. */}
        {paddling && (
          <section className="flex flex-col gap-3" aria-label="Your paddling">
            <div>
              <h2 className="text-lg font-semibold text-fg">Your paddling</h2>
              <p className="text-sm text-muted">Only you see this part.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Tile label="This year" value={`${paddling.thisYearKm} km`} />
              <Tile label="Paddles" value={String(paddling.count)} />
              <Tile label="Streak" value={paddling.streak ? `${paddling.streak} wk` : '—'} />
            </div>
            {(paddling.longest || paddling.fastest) && (
              <ul className="text-base flex flex-col gap-1">
                {paddling.longest && <li>Longest: <Link href={`/paddles/${paddling.longest.id}`} className="tt-link tabular whitespace-nowrap">{paddling.longest.km.toFixed(1)} km on {fmtDay(paddling.longest.paddledAt)}</Link></li>}
                {paddling.fastest && <li>Fastest cruise: <Link href={`/paddles/${paddling.fastest.id}`} className="tt-link tabular whitespace-nowrap">{split500(paddling.fastest.cruiseSpeed)} /500 on {fmtDay(paddling.fastest.paddledAt)}</Link></li>}
              </ul>
            )}
          </section>
        )}

        {/* Races: only results the viewer could already see on a leaderboard. */}
        <Section title="Races">
          {stats.races.length === 0 ? (
            <EmptyState
              title="No race results yet"
              body={isOwner ? 'Enter a time trial and your results show here.' : undefined}
              action={isOwner ? <Link href="/att" className={buttonClass('secondary')}>See open trials</Link> : undefined}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Races" value={String(stats.totals.races)} />
              <Tile label="Courses" value={String(stats.totals.courses)} />
              <Tile label="Race distance" value={fmtKm(stats.totals.distanceMetres)} />
              <Tile label="Racing since" value={fmtMonthYear(stats.totals.since)} />
            </div>
          )}
        </Section>

        {stats.races.length > 0 && (
          <>
            {/* Best pace / speed */}
            {stats.bestRace && (
              <Section title="Best race pace">
                <div className="grid grid-cols-2 gap-3">
                  <Tile label="Pace /500" value={paceFor500m(stats.bestRace.distanceMetres, stats.bestRace.totalElapsedSeconds)} />
                  <Tile label="Speed" value={speedKmh(stats.bestRace.distanceMetres, stats.bestRace.totalElapsedSeconds)} />
                </div>
                <p className="text-sm text-muted">On {stats.bestRace.courseName} (<span className="tabular">{formatTime(stats.bestRace.totalElapsedSeconds)}</span>)</p>
              </Section>
            )}

            {/* Personal bests per course */}
            <Section title="Personal bests">
              <div className="border border-border">
                {stats.personalBests.map(pb => (
                  <div key={pb.courseId} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border last:border-b-0">
                    <span className="text-base text-fg min-w-0 truncate">{pb.courseName}</span>
                    <span className="text-base text-primary-text tabular shrink-0 whitespace-nowrap">
                      {formatTime(pb.bestSeconds)}
                      <span className="text-muted ml-2">×{pb.raceCount}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            {/* Boat classes */}
            {stats.boatClasses.length > 0 && (
              <Section title="Boat classes">
                <div className="flex flex-wrap gap-2">
                  {stats.boatClasses.map(bc => (
                    <span key={bc.boatClass} className={`${cardClass} px-3 py-1.5 text-base text-fg tabular`}>
                      {bc.boatClass} <span className="text-muted">×{bc.count}</span>
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Race history */}
            <Section title="Race history">
              <div className="border border-border">
                {stats.races.map(r => (
                  <Link
                    key={r.entryId}
                    href={`/att/entries/${r.entryId}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-surface transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-base text-fg truncate">{r.courseName}</span>
                      <span className="block text-sm text-muted">
                        {r.trialName} · <span className="whitespace-nowrap">{fmtDay(r.raceDate)}</span> · {r.boatClass}
                      </span>
                    </span>
                    <span className="text-base text-primary-text tabular shrink-0">{formatTime(r.totalElapsedSeconds)}</span>
                  </Link>
                ))}
              </div>
            </Section>
          </>
        )}
      </Page>
    </main>
  )
}
