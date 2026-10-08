'use client'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import { trpc } from '@/lib/trpc'
import { PREFILLED_FRESH_MS } from '@/lib/fresh'

export default function SavedPaddle({ id }: { id: string }) {
  const q = trpc.paddles.get.useQuery({ id }, { retry: false, staleTime: PREFILLED_FRESH_MS })

  // A paddle saved without its AI summary (so it could open at once) asks for
  // it here, once per visit; the plain summary shows meanwhile. If the page is
  // closed first, the next visit asks again.
  const utils = trpc.useUtils()
  const write = trpc.paddles.writeSummary.useMutation({
    onSuccess: s => utils.paddles.get.setData({ id }, s),
  })
  const asked = useRef(false)
  const pending = !!q.data?.insightPending
  useEffect(() => {
    if (pending && !asked.current) { asked.current = true; write.mutate({ id }) }
  }, [pending, id, write])

  if (q.isPending) return <main className="flex-1 flex items-center justify-center text-sm text-muted">Loading…</main>
  if (q.isError || !q.data) return (
    <main className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
      <p className="text-sm text-muted">We can&apos;t find this paddle.</p>
      <Link href="/paddles" className="text-xs tracking-widest text-primary">← PADDLES</Link>
    </main>
  )

  const session = q.data
  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type, stravaActivityId: session.source.stravaActivityId } }} sessionId={session.id} initialNote={session.note} initialBoatClass={session.boatClass} initialSeat={session.seat} summaryPending={pending && !write.isError} />
}
