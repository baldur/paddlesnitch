'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import BoatMotion from '@/components/devices/BoatMotion'
import LoadingState from '@/components/LoadingState'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { EmptyState } from '@paddlesnitch/ui/Card'
import type { DeviceSessionMeta } from '@/lib/devices'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import { fmtDayTime } from '@paddlesnitch/core/format'

const fmtDate = (iso?: string) => (iso ? fmtDayTime(iso) : '—')

export default function RecordingMotion() {
  const params = useParams<{ deviceId: string; sessionId: string }>()
  const sessionId = params?.sessionId ?? ''
  const deviceId = (params?.deviceId ?? '').toUpperCase()
  const [meta, setMeta] = useState<DeviceSessionMeta | null | 'missing'>(null)
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)
  const [cadence, setCadence] = useState<CadenceReport | null>(null)
  const [noPaddle, setNoPaddle] = useState<string | null>(null)
  const [fromMotion, setFromMotion] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // The session list is already owner-filtered, and it is where the
        // deviceId comes from — so the URL can carry just the session id.
        const listRes = await fetch('/api/account/devices/sessions')
        const list: { sessions?: DeviceSessionMeta[] } = listRes.ok ? await listRes.json() : {}
        const found = (list.sessions ?? []).find(s => s.sessionId === sessionId)
        if (cancelled) return
        if (!found) { setMeta('missing'); setState('ready'); return }
        setMeta(found)

        const res = await fetch(`/api/account/devices/sessions/${sessionId}?deviceId=${encodeURIComponent(found.deviceId)}`)
        const d = await res.json()
        if (cancelled) return
        setAttitude(d.attitude ?? null)
        setCadence(d.cadence ?? null)
        setNoPaddle(d.noPaddle ?? null)
        setFromMotion(d.fromMotion ?? null)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={
        <Link href={`/devices/${deviceId}`} className="tt-nav-link">← Tracker</Link>
      } />
      <Page width="wide">
        {state === 'loading' && <LoadingState label="Loading" />}
        {state === 'error' && <p className="text-base text-red" role="alert">Couldn’t read this recording. Please try again.</p>}

        {state === 'ready' && meta === 'missing' && (
          <EmptyState
            title="We can't find this recording"
            action={<Link href="/devices" className={buttonClass('secondary')}>Back to Devices</Link>}
          />
        )}

        {state === 'ready' && meta && meta !== 'missing' && (
          <>
            <PageHeader
              title="Boat motion"
              description={<span className="tabular">{fmtDate(meta.startedAt ?? meta.uploadedAt)} · {meta.filename}</span>}
            />
            {noPaddle && <p className="text-base text-fg border-l-2 border-primary pl-3 -mt-4">{noPaddle}{fromMotion ? ` ${fromMotion}` : ''}</p>}

            <BoatMotion attitude={attitude} strokeRate={cadence?.available ? cadence.medianStrokesPerMin : null} />
          </>
        )}
      </Page>
    </main>
  )
}
