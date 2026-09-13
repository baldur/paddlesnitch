'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'

// Public, read-only view of a shared paddle (#202). No sessionId is passed, so
// AnalysisView renders without any of the owner-only edit controls; `readOnly`
// swaps the "MY PADDLES" link for a call to analyse your own.
export default function SharedPaddlePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params)
  const q = trpc.paddles.shared.useQuery({ shareId }, { retry: false })

  if (q.isPending) return <div className="fixed inset-0 bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Loading…</div>
  if (q.isError || !q.data) return (
    <div className="fixed inset-0 bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">This shared paddle doesn&apos;t exist, or the link was revoked.</p>
      <Link href="/paddles/new" className="text-xs tracking-widest text-[#0369a1]">ANALYSE YOUR OWN →</Link>
    </div>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type } }} initialBoatClass={session.boatClass} initialSeat={session.seat} readOnly />
}
