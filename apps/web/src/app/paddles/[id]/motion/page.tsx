'use client'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import LoadingState from '@/components/LoadingState'
import BoatMotion from '@/components/devices/BoatMotion'
import TechnicalDetails from '@/components/devices/TechnicalDetails'
import { trpc } from '@/lib/trpc'
import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// A tracker paddle's BOAT MOTION (docs/features/one-paddle.md, phase 3): the
// roll, pitch and evenness charts that used to live on the recording's page,
// with the recording's technical details under them. Owner only: the recording
// read is owner-gated server-side.

type Recording = { report: DeviceDataReport; cadence: CadenceReport | null; attitude: AttitudeReport | null }

const fmtDate = (iso?: string) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}

export default function PaddleMotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const q = trpc.paddles.get.useQuery({ id }, { retry: false })
  const src = q.data?.source
  const fromTracker = src?.type === 'device' && !!src.deviceId && !!src.deviceSessionId
  const [rec, setRec] = useState<Recording | 'error' | null>(null)

  useEffect(() => {
    if (!fromTracker || !src) return
    let cancelled = false
    fetch(`/api/account/devices/sessions/${src.deviceSessionId}?deviceId=${encodeURIComponent(src.deviceId!)}`)
      .then(async r => {
        const d = await r.json()
        if (!cancelled) setRec(r.ok && d.report ? { report: d.report, cadence: d.cadence ?? null, attitude: d.attitude ?? null } : 'error')
      })
      .catch(() => { if (!cancelled) setRec('error') })
    return () => { cancelled = true }
  }, [fromTracker, src])

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href={`/paddles/${id}`} className="tt-nav-link text-sm shrink-0">← PADDLE</Link>} />
      <div className="flex-1 px-4 py-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
        {q.isPending && <LoadingState label="Loading" />}
        {(q.isError || (!q.isPending && !q.data)) && (
          <p className="text-sm text-muted">
            We can&apos;t find this paddle. <Link href="/paddles" className="text-primary">Back to paddles</Link>.
          </p>
        )}
        {q.data && (
          <>
            <div>
              <h1 className="text-lg font-bold text-fg tracking-widest">BOAT MOTION</h1>
              <p className="text-sm text-muted mt-1 tabular">{fmtDate(q.data.paddledAt)}</p>
            </div>
            {!fromTracker && (
              <p className="text-sm text-muted">
                This paddle didn&apos;t come from a paddlesnitch tracker, so there&apos;s no boat motion for it.
              </p>
            )}
            {fromTracker && rec === null && <LoadingState label="Loading" />}
            {fromTracker && rec === 'error' && <p className="text-sm text-red">Couldn’t read the tracker&apos;s recording. Please try again.</p>}
            {fromTracker && rec && rec !== 'error' && (
              <>
                <BoatMotion attitude={rec.attitude} strokeRate={q.data.result.avgSR} />
                <TechnicalDetails report={rec.report} cadence={rec.cadence} attitude={rec.attitude} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
