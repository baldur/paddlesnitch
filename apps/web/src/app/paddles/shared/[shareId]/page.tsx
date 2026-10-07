'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'

// Public, read-only view of a shared paddle (#202). No sessionId is passed, so
// AnalysisView renders without any of the owner-only edit controls; `readOnly`
// swaps the "PADDLES" link for a call to analyse your own.
export default function SharedPaddlePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params)
  const q = trpc.paddles.shared.useQuery({ shareId }, { retry: false })

  if (q.isPending) return <main className="flex-1 flex items-center justify-center text-sm text-muted">Loading…</main>
  if (q.isError || !q.data) return (
    <main className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
      <p className="text-sm text-muted">We can&apos;t find this shared paddle. Its owner may have stopped sharing it.</p>
      <Link href="/paddles/new" className="text-xs tracking-widest text-primary">ANALYSE YOUR OWN →</Link>
    </main>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type } }} initialBoatClass={session.boatClass} initialSeat={session.seat} readOnly />
}
