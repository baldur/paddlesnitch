'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fmtEvenness } from '@/lib/tracker-copy'
import { eyebrowClass } from '@paddlesnitch/ui/Layout'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// A compact boat-motion summary on a tracker (or phone) paddle's detail page
// (#866): the side-to-side roll, bow-to-stern pitch and rock evenness, with a
// link to the full charts on the Boat motion page. Owner only — the recording
// read is owner-gated. Shows nothing until the motion data is in and readable,
// so a paddle whose motion hasn't arrived (or yielded nothing) gains no empty
// box here; the quiet "Boat motion" action still leads to the full page.
export default function BoatMotionSummary({ paddleId, deviceId, deviceSessionId }:
  { paddleId: string; deviceId: string; deviceSessionId: string }) {
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/account/devices/sessions/${deviceSessionId}?deviceId=${encodeURIComponent(deviceId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.attitude) setAttitude(d.attitude) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [deviceId, deviceSessionId])

  if (!attitude?.available) return null
  return (
    <section aria-label="Boat motion" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">Boat motion</h2>
        <Link href={`/paddles/${paddleId}/motion`} className="text-sm text-primary-text hover:underline shrink-0">See the charts →</Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Side-to-side roll" value={`${attitude.rollRmsDeg}°`} note="typical lean" />
        <Tile label="Bow-to-stern pitch" value={`${attitude.pitchRmsDeg}°`} note="typical tilt" />
        <Tile label="Evenness"
          value={attitude.symmetry ? fmtEvenness(attitude.symmetry.imbalancePct) : '—'}
          note={attitude.symmetry ? 'uneven' : ''} />
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
