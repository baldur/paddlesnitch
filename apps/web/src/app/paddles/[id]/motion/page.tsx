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
import { fmtDayTime } from '@paddlesnitch/core/format'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { EmptyState } from '@paddlesnitch/ui/Card'

// A tracker paddle's BOAT MOTION (docs/features/one-paddle.md, phase 3): the
// roll, pitch and evenness charts that used to live on the recording's page,
// with the recording's technical details under them. Owner only: the recording
// read is owner-gated server-side.

type Recording = { report: DeviceDataReport; cadence: CadenceReport | null; attitude: AttitudeReport | null }

const fmtDate = (iso?: string) => (iso ? fmtDayTime(iso) : '')

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
      <AppHeader breadcrumb={<Link href={`/paddles/${id}`} className="tt-nav-link text-sm shrink-0">← Paddle</Link>} />
      <Page width="wide">
        {q.isPending && <LoadingState label="Loading" />}
        {(q.isError || (!q.isPending && !q.data)) && (
          <EmptyState title="We can't find this paddle"
            action={<Link href="/paddles" className={buttonClass('secondary')}>Back to Paddles</Link>} />
        )}
        {q.data && (
          <>
            <PageHeader title="Boat motion" eyebrow={fmtDate(q.data.paddledAt)} />
            {!fromTracker && (
              <EmptyState title="No boat motion for this paddle"
                body={<>This paddle didn&apos;t come from a paddlesnitch tracker. Boat motion needs one fixed in the boat.</>}
                action={<>
                  <Link href={`/paddles/${id}`} className={buttonClass('secondary')}>Back to the paddle</Link>
                  <Link href="/guide" className={buttonClass('quiet')}>About the tracker</Link>
                </>} />
            )}
            {fromTracker && rec === null && <LoadingState label="Loading" />}
            {fromTracker && rec === 'error' && <p className="text-base text-red" role="alert">Couldn’t read the tracker&apos;s recording. Please try again.</p>}
            {fromTracker && rec && rec !== 'error' && (
              <>
                <BoatMotion attitude={rec.attitude} strokeRate={q.data.result.avgSR} />
                <TechnicalDetails report={rec.report} cadence={rec.cadence} attitude={rec.attitude} />
              </>
            )}
          </>
        )}
      </Page>
    </main>
  )
}
