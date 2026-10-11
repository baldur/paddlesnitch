'use client'
import Link from 'next/link'
import { use } from 'react'
import { fmtWeekday } from '@paddlesnitch/core/format'
import { fmtClock, split500 } from '@paddlesnitch/analysis/analysis'
import AppHeader from '@/components/AppHeader'
import RouteThumb from '@paddlesnitch/ui/RouteThumb'
import NoGpsTag from '@/components/paddles/NoGpsTag'
import { isMotionOnly, paddleKm } from '@paddlesnitch/core/paddles'
import { trpc } from '@/lib/trpc'

// A buddy's paddles (docs/features/buddies-and-compare.md): the ones they let
// buddies see. Not a buddy (or they've stopped sharing): we say we can't find it.
export default function BuddyPaddlesPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const q = trpc.buddies.paddles.useQuery({ userId }, { retry: false })

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/buddies" className="tt-nav-link text-sm shrink-0">← BUDDIES</Link>} />
      <div className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
        {q.isPending ? <p className="text-sm text-muted">Loading…</p>
          : q.isError || !q.data ? (
            <p className="text-sm text-muted">We can&apos;t find these paddles. You may not be buddies, or they&apos;ve stopped sharing.</p>
          ) : (
            <>
              <h1 className="text-lg font-bold tracking-widest">{q.data.name.toUpperCase()}&apos;S PADDLES</h1>
              <p className="text-sm text-muted mt-1 mb-6">Open one to see it, or to compare it with one of yours.</p>
              {q.data.paddles.length === 0 ? <p className="border border-border px-4 py-6 text-sm text-muted">Nothing to see yet.</p> : (
                <div className="flex flex-col gap-2">
                  {q.data.paddles.map(p => (
                    <Link key={p.id} href={`/buddies/${userId}/${p.id}`} className="border border-border px-4 py-3 flex gap-3 items-center hover:border-primary">
                      {isMotionOnly(p) ? <NoGpsTag /> : p.route && p.route.length > 1 && <RouteThumb route={p.route} />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[10px] text-muted tracking-widest uppercase">{fmtWeekday(p.paddledAt)}</span>
                        <span className="block text-sm tabular">
                          {paddleKm(p)} · {fmtClock(p.durationS)}{isMotionOnly(p) ? '' : ` · ${split500(p.cruiseSpeed)}/500`}{p.avgSR != null ? ` · ${Math.round(p.avgSR)} spm` : ''}
                        </span>
                      </span>
                      {p.boatClass && <span className="text-xs text-muted">{p.boatClass}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
      </div>
    </main>
  )
}
