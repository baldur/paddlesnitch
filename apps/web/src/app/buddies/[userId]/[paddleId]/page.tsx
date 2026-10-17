'use client'
import Link from 'next/link'
import { use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'

// One of a buddy's paddles, read-only: as others see it, without their notes or
// the AI summary (docs/features/buddies-and-compare.md).
export default function BuddyPaddlePage({ params }: { params: Promise<{ userId: string; paddleId: string }> }) {
  const { userId, paddleId } = use(params)
  const q = trpc.buddies.paddle.useQuery({ userId, id: paddleId }, { retry: false })

  if (q.isPending) return <main className="flex-1 flex items-center justify-center text-sm text-muted">Loading…</main>
  if (q.isError || !q.data) return (
    <main className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
      <p className="text-sm text-muted">We can&apos;t find this paddle.</p>
      <Link href="/buddies" className="text-xs tracking-widest text-primary-text">← BUDDIES</Link>
    </main>
  )
  const { name, paddle } = q.data
  return (
    <AnalysisView
      data={{ ...paddle.result, paddledAt: paddle.paddledAt, source: { type: paddle.source.type } }}
      initialBoatClass={paddle.boatClass} initialSeat={paddle.seat}
      readOnly buddy={{ name, href: `/buddies/${userId}`, userId, paddleId }}
    />
  )
}
