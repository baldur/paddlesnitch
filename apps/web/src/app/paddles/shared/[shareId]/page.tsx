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

// Public, read-only view of a shared paddle (#202). No sessionId is passed, so
// AnalysisView renders without any of the owner-only edit controls; `readOnly`
// swaps the "PADDLES" link for a call to analyse your own.
export default function SharedPaddlePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params)
  const q = trpc.paddles.shared.useQuery({ shareId }, { retry: false })

  if (q.isPending) return <main className="flex-1 flex"><LoadingState label="Loading" /></main>
  if (q.isError || !q.data) return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={null} />
      <Page width="narrow">
        <EmptyState title="We can't find this shared paddle" body="Its owner may have stopped sharing it."
          action={<Link href="/paddles/new" className={buttonClass('primary')}>Add your own paddle</Link>} />
      </Page>
    </main>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type, phone: session.source.phone } }} initialBoatClass={session.boatClass} initialSeat={session.seat} readOnly />
}
