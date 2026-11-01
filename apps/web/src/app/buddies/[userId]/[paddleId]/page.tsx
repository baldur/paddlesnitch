'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import { Page } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { EmptyState } from '@paddlesnitch/ui/Card'

// One of a buddy's paddles, read-only: as others see it, without their notes or
// the AI summary (docs/features/buddies-and-compare.md).
export default function BuddyPaddlePage({ params }: { params: Promise<{ userId: string; paddleId: string }> }) {
  const { userId, paddleId } = use(params)
  const q = trpc.buddies.paddle.useQuery({ userId, id: paddleId }, { retry: false })

  if (q.isPending) return <main className="flex-1 flex"><LoadingState label="Loading" /></main>
  if (q.isError || !q.data) return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/buddies" className="tt-nav-link text-sm shrink-0">← Buddies</Link>} />
      <Page width="narrow">
        <EmptyState title="We can't find this paddle" body="Your buddy may have hidden it or stopped sharing."
          action={<Link href={`/buddies/${userId}`} className={buttonClass('secondary')}>Back to their paddles</Link>} />
      </Page>
    </main>
  )
  const { name, paddle } = q.data
  return (
    <AnalysisView
      data={{ ...paddle.result, paddledAt: paddle.paddledAt, source: { type: paddle.source.type, phone: paddle.source.phone } }}
      initialBoatClass={paddle.boatClass} initialSeat={paddle.seat}
      readOnly buddy={{ name, href: `/buddies/${userId}`, userId, paddleId }}
    />
  )
}
