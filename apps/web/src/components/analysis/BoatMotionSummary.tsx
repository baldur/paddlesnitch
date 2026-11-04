'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fmtEvenness } from '@/lib/tracker-copy'
import { Tile } from '@/components/devices/BoatMotion'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// The balance part of boat motion on a tracker (or phone) paddle's own page
// (#866): evenness first, then side-to-side roll, with a link to the full
// charts on the Boat motion page. The tiles and their words are the Boat
// motion page's (one Tile). Owner only: the recording read is owner-gated.
// Shows nothing until the motion is in and readable, so a paddle without it
// gains no empty box; the quiet "Boat motion" action still leads to the page.
// `motion=1` asks for the boat motion only, not the technical details' rows.
export default function BoatMotionSummary({ paddleId, deviceId, deviceSessionId }:
  { paddleId: string; deviceId: string; deviceSessionId: string }) {
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/account/devices/sessions/${encodeURIComponent(deviceSessionId)}?deviceId=${encodeURIComponent(deviceId)}&motion=1`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.attitude) setAttitude(d.attitude) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [deviceId, deviceSessionId])

  if (!attitude?.available) return null
  return (
    <section aria-label="Boat motion" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">Boat motion</h2>
        <Link href={`/paddles/${paddleId}/motion`} className="min-h-11 inline-flex items-center text-sm text-primary-text hover:underline shrink-0">All charts →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Evenness"
          value={attitude.symmetry ? fmtEvenness(attitude.symmetry.imbalancePct) : '—'}
          note={attitude.symmetry ? 'uneven' : ''} />
        <Tile label="Side-to-side roll" value={`${attitude.rollRmsDeg}°`} note="typical lean" />
      </div>
    </section>
  )
}
