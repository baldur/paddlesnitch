'use client'
import Link from 'next/link'
import { useState, useEffect, use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import type { AnalysisSession } from '@/lib/analysis-store'

export default function SavedPaddlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [session, setSession] = useState<AnalysisSession | null | undefined>(undefined)

  useEffect(() => {
    fetch(`/analyse/api/analyse/sessions/${id}`).then(r => (r.ok ? r.json() : null)).then(d => setSession(d?.session ?? null)).catch(() => setSession(null))
  }, [id])

  if (session === undefined) return <div className="fixed inset-0 bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Loading…</div>
  if (!session) return (
    <div className="fixed inset-0 bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">This paddle doesn&apos;t exist, or you can&apos;t see it.</p>
      <Link href="/library" className="text-xs tracking-widest text-[#0369a1]">← MY PADDLES</Link>
    </div>
  )

  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type } }} sessionId={session.id} initialNote={session.note} initialBoatClass={session.boatClass} initialSeat={session.seat} />
}
