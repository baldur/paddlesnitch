import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { getUserGroupIds } from '@/lib/groups'
import { getProfileSettings, buildProfileStats, resolveToUserId } from '@/lib/profile'
import { formatTime } from '@/lib/geo'
import { paceFor500m, speedKmh, speedMs } from '@/lib/format'
import AppHeader from '@/components/AppHeader'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted tracking-[0.2em] uppercase">{label}</div>
      <div className="text-lg text-fg tabular mt-1">{value}</div>
    </div>
  )
}

function fmtKm(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`
}

function fmtMonthYear(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default async function ProfilePage({
  params,
}: {
  // The dynamic segment is a handle OR a userId (kept the folder name [userId]).
  params: Promise<{ userId: string }>
}) {
  const { userId: segment } = await params
  // A claimed handle resolves to its owner; otherwise the segment is a userId.
  const userId = await resolveToUserId(segment)
  const viewer = await getAuthUser()
  const isOwner = viewer?.id === userId

  // Opt-in: a private profile is invisible to everyone but its owner. Same 404
  // as a missing user — no "exists but private" leak.
  const settings = await getProfileSettings(userId)
  if (!settings.public && !isOwner) notFound()

  // Canonical URL: if the user has a handle and they were reached some other way
  // (by userId, or a different-cased handle), redirect to /att/u/{handle}.
  if (settings.handle && segment !== settings.handle) {
    redirect(`/att/u/${settings.handle}`)
  }

  const viewerGroupIds = viewer ? new Set(await getUserGroupIds(viewer.id)) : new Set<string>()
  const stats = await buildProfileStats(userId, viewer, viewerGroupIds)

  const name = stats.displayName ?? (isOwner ? viewer!.displayName : 'Paddler')

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={<Link href="/att" className="tt-nav-link text-sm shrink-0">← HOME</Link>}
      />

      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full flex flex-col gap-8">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-wide">{name}</h1>
          <p className="text-sm text-muted mt-1">Paddler profile</p>
        </div>

        {isOwner && !settings.public && (
          <div className="border border-primary bg-primary/10 px-4 py-3 text-xs text-primary">
            Only you can see this profile. Make it public from your{' '}
            <Link href="/att/account" className="underline">account page</Link> to share it.
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Races" value={String(stats.totals.races)} />
          <Stat label="Courses" value={String(stats.totals.courses)} />
          <Stat label="Distance" value={fmtKm(stats.totals.distanceMetres)} />
          <Stat label="Since" value={fmtMonthYear(stats.totals.since)} />
        </div>

        {stats.races.length === 0 ? (
          <p className="text-sm text-muted">No race results to show yet.</p>
        ) : (
          <>
            {/* Best pace / speed */}
            {stats.bestRace && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs text-muted tracking-[0.2em] uppercase">Personal best pace</h2>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Pace /500m" value={paceFor500m(stats.bestRace.distanceMetres, stats.bestRace.totalElapsedSeconds)} />
                  <Stat label="Speed" value={speedKmh(stats.bestRace.distanceMetres, stats.bestRace.totalElapsedSeconds)} />
                  <Stat label="Speed" value={speedMs(stats.bestRace.distanceMetres, stats.bestRace.totalElapsedSeconds)} />
                </div>
                <p className="text-xs text-muted">on {stats.bestRace.courseName} ({formatTime(stats.bestRace.totalElapsedSeconds)})</p>
              </section>
            )}

            {/* Personal bests per course */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs text-muted tracking-[0.2em] uppercase">Personal bests</h2>
              <div className="border border-border">
                {stats.personalBests.map(pb => (
                  <div key={pb.courseId} className="flex items-center justify-between px-4 py-2 border-b border-surface-2 last:border-b-0">
                    <span className="text-sm text-fg min-w-0 truncate">{pb.courseName}</span>
                    <span className="text-sm text-primary tabular shrink-0 ml-3">
                      {formatTime(pb.bestSeconds)}
                      <span className="text-muted ml-2">×{pb.raceCount}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Boat classes */}
            {stats.boatClasses.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs text-muted tracking-[0.2em] uppercase">Boat classes</h2>
                <div className="flex flex-wrap gap-2">
                  {stats.boatClasses.map(bc => (
                    <span key={bc.boatClass} className="border border-border bg-surface px-3 py-1 text-sm text-fg tabular">
                      {bc.boatClass} <span className="text-muted">×{bc.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Race history */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs text-muted tracking-[0.2em] uppercase">Race history</h2>
              <div className="border border-border">
                {stats.races.map(r => (
                  <Link
                    key={r.entryId}
                    href={`/att/entries/${r.entryId}`}
                    className="flex items-center justify-between px-4 py-2 border-b border-surface-2 last:border-b-0 hover:bg-surface transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-fg truncate">{r.courseName}</span>
                      <span className="block text-xs text-muted tabular">{r.trialName} · {r.raceDate} · {r.boatClass}</span>
                    </span>
                    <span className="text-sm text-primary tabular shrink-0 ml-3">{formatTime(r.totalElapsedSeconds)}</span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
