'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'

export default function SavedPaddlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const q = trpc.paddles.get.useQuery({ id }, { retry: false })

  if (q.isPending) return <div className="fixed inset-0 bg-bg text-muted flex items-center justify-center text-sm">Loading…</div>
  if (q.isError || !q.data) return (
    <div className="fixed inset-0 bg-bg text-fg flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">We can&apos;t find this paddle.</p>
      <Link href="/paddles" className="text-xs tracking-widest text-primary">← PADDLES</Link>
    </div>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type, stravaActivityId: session.source.stravaActivityId } }} sessionId={session.id} initialNote={session.note} initialBoatClass={session.boatClass} initialSeat={session.seat} />
}
