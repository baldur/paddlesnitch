'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import BoatMotion from '@/components/devices/BoatMotion'
import LoadingState from '@/components/LoadingState'
import type { DeviceSessionMeta } from '@/lib/devices'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'

const fmtDate = (iso?: string) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso.slice(0, 16) }
}

export default function RecordingMotion() {
  const params = useParams<{ deviceId: string; sessionId: string }>()
  const sessionId = params?.sessionId ?? ''
  const deviceId = (params?.deviceId ?? '').toUpperCase()
  const [meta, setMeta] = useState<DeviceSessionMeta | null | 'missing'>(null)
  const [attitude, setAttitude] = useState<AttitudeReport | null>(null)
  const [cadence, setCadence] = useState<CadenceReport | null>(null)
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
        <Link href={`/devices/${deviceId}`} className="tt-nav-link text-sm shrink-0">← TRACKER</Link>
      } />
      <div className="flex-1 px-4 py-8 max-w-4xl mx-auto w-full flex flex-col gap-6">
        {state === 'loading' && <LoadingState label="Loading" />}
        {state === 'error' && <p className="text-sm text-red">Couldn’t read this recording. Please try again.</p>}

        {state === 'ready' && meta === 'missing' && (
          <p className="text-sm text-muted">
            We can&apos;t find this recording.{' '}
            <Link href="/devices" className="text-primary">Back to devices</Link>.
          </p>
        )}

        {state === 'ready' && meta && meta !== 'missing' && (
          <>
            <div>
              <h1 className="text-lg font-bold text-fg tracking-widest">BOAT MOTION</h1>
              <p className="text-sm text-muted mt-1 tabular">
                {fmtDate(meta.startedAt ?? meta.uploadedAt)} · {meta.filename}
              </p>
            </div>

            <BoatMotion attitude={attitude} strokeRate={cadence?.available ? cadence.medianStrokesPerMin : null} />
          </>
        )}
      </div>
    </main>
  )
}
