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
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Chevron, EmptyState, cardLinkClass } from '@paddlesnitch/ui/Card'

// A buddy's paddles (docs/features/buddies-and-compare.md): the ones they let
// buddies see. Not a buddy (or they've stopped sharing): we say we can't find it.
export default function BuddyPaddlesPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const q = trpc.buddies.paddles.useQuery({ userId }, { retry: false })

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/buddies" className="tt-nav-link text-sm shrink-0">← Buddies</Link>} />
      <Page>
        {q.isPending ? <LoadingState label="Loading" className="py-10" />
          : q.isError || !q.data ? (
            <EmptyState title="We can't find these paddles" body="You may not be buddies, or they've stopped sharing."
              action={<Link href="/buddies" className={buttonClass('secondary')}>Back to Buddies</Link>} />
          ) : (
            <>
              <PageHeader title={`${q.data.name}'s paddles`} description="Open one to see it, or to compare it with one of yours." />
              {q.data.paddles.length === 0 ? <EmptyState title="Nothing to see yet" body={`When ${q.data.name} adds a paddle, it shows here.`} /> : (
                <ul className="flex flex-col gap-2">
                  {q.data.paddles.map(p => (
                    <li key={p.id}>
                      <Link href={`/buddies/${userId}/${p.id}`} className={`${cardLinkClass} p-3 flex gap-3 items-center`}>
                        {isMotionOnly(p) ? <NoGpsTag /> : p.route && p.route.length > 1 && <RouteThumb route={p.route} size={64} />}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-muted">{fmtWeekday(p.paddledAt)}{p.boatClass && <span className="text-split"> · {p.boatClass}</span>}</span>
                          <span className="block text-lg font-semibold tabular text-fg">{paddleKm(p)} · {fmtClock(p.durationS)}</span>
                          <span className="block text-sm text-muted tabular">
                            {isMotionOnly(p) ? '' : `${split500(p.cruiseSpeed)} /500`}{p.avgSR != null ? `${isMotionOnly(p) ? '' : ' · '}${Math.round(p.avgSR)} spm` : ''}
                          </span>
                        </span>
                        <Chevron />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </Page>
    </main>
  )
}
