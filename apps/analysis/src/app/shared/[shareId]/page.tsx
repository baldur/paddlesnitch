'use client'
import Link from 'next/link'
import { useState, useEffect, use } from 'react'
import AnalysisView from '@/components/analysis/AnalysisView'
import type { AnalysisResult } from '@/lib/analysis'
import type { BoatClass, Seat } from '@paddlesnitch/core/types'

type SharedSession = {
  id: string
  paddledAt: string
  source: { type: 'file' | 'strava' | 'trial' }
  result: AnalysisResult
  boatClass?: BoatClass
  seat?: Seat
}

// Public, read-only view of a shared paddle (#202). No sessionId is passed, so
// AnalysisView renders without any of the owner-only edit controls; `readOnly`
// swaps the "MY PADDLES" link for a call to analyse your own.
export default function SharedPaddlePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params)
  const [session, setSession] = useState<SharedSession | null | undefined>(undefined)

  useEffect(() => {
    fetch(`/analyse/api/analyse/shared/${shareId}`).then(r => (r.ok ? r.json() : null)).then(d => setSession(d?.session ?? null)).catch(() => setSession(null))
  }, [shareId])

  if (session === undefined) return <div className="fixed inset-0 bg-[#0b1220] text-[#64748b] flex items-center justify-center text-sm">Loading…</div>
  if (!session) return (
    <div className="fixed inset-0 bg-[#0b1220] text-[#e2e8f0] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-[#64748b]">This shared paddle doesn&apos;t exist, or the link was revoked.</p>
      <Link href="/" className="text-xs tracking-widest text-[#0369a1]">ANALYSE YOUR OWN →</Link>
    </div>
  )

  return <AnalysisView data={{ ...session.result, paddledAt: session.paddledAt, source: { type: session.source.type } }} initialBoatClass={session.boatClass} initialSeat={session.seat} readOnly />
}
