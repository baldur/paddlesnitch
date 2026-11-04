'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import { fmtEvenness } from '@/lib/tracker-copy'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// A compact boat-motion readout on the paddle page itself (#866): the balance
// (evenness) and side-to-side roll, with a link to the full charts. Owner only —
// the recording read is owner-gated server-side, so this is not rendered on a
// shared or a buddy's paddle.
//
// Quiet by design: it fetches the owner-gated recording the same way the full
// Boat motion page does, and when the motion file hasn't arrived or carried no
// usable attitude it renders nothing. The "Boat motion" action and page stay the
// source of truth for the detail and for the no-motion explanation.
export default function PaddleBoatMotionSummary({ sessionId, deviceId, deviceSessionId }: {
  sessionId: string
  deviceId: string
  deviceSessionId: string
}) {
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/account/devices/sessions/${deviceSessionId}?deviceId=${encodeURIComponent(deviceId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setAttitude(d?.attitude ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [deviceId, deviceSessionId])

  if (!attitude?.available) return null

  return (
    <section aria-label="Boat motion" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className={eyebrowClass}>Boat motion</h2>
        <Link href={`/paddles/${sessionId}/motion`} className="text-sm text-primary-text">See boat motion →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Evenness" value={attitude.symmetry ? fmtEvenness(attitude.symmetry.imbalancePct) : '—'}
          note={attitude.symmetry ? 'how evenly the boat rocked' : ''} />
        <Tile label="Side-to-side roll" value={attitude.rollRmsDeg != null ? `${attitude.rollRmsDeg}°` : '—'}
          note="typical lean" />
      </div>
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-control border border-border bg-surface px-3 py-2 min-w-0">
      <div className={eyebrowClass}>{label}</div>
      <div className="text-fg tabular text-xl mt-0.5">{value}</div>
      {note && <div className="text-sm text-muted">{note}</div>}
    </div>
  )
}
