'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'

export default function SavedPaddlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const q = trpc.paddles.get.useQuery({ id }, { retry: false })

  if (q.isPending) return <div className="fixed inset-0 bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Loading…</div>
  if (q.isError || !q.data) return (
    <div className="fixed inset-0 bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">This paddle doesn&apos;t exist, or you can&apos;t see it.</p>
      <Link href="/analyse/library" className="text-xs tracking-widest text-[#0369a1]">← MY PADDLES</Link>
    </div>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type, stravaActivityId: session.source.stravaActivityId } }} sessionId={session.id} initialNote={session.note} initialBoatClass={session.boatClass} initialSeat={session.seat} />
}
