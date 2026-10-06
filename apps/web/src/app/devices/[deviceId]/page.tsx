'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import RemoveTrackerButton from '@/components/devices/RemoveTrackerButton'
import TechnicalDetails, { Stat } from '@/components/devices/TechnicalDetails'
import { strokeRateCopy, gpsCopy } from '@/lib/tracker-copy'
import type { DeviceSessionMeta } from '@/lib/devices'
import { type DeviceView, fmtDate, fmtDay, fmtDist, fmtDur, MIN_PADDLE_METRES } from '@/lib/device-view'
import { trpc } from '@/lib/trpc'
import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// One tracker's recordings. Each opens to a plain summary (time, distance,
// speed, stroke rate, boat motion) with the engineering diagnostics behind a
// TECHNICAL DETAILS toggle.

type SessionReport = {
  report: DeviceDataReport
  cadence: CadenceReport | null
  attitude: AttitudeReport | null
}

function Report({ report, cadence, attitude, sessionId, deviceId }: SessionReport & { sessionId: string; deviceId: string }) {
  const sr = strokeRateCopy(report, cadence)
  const gps = gpsCopy(report)
  // Derived from the fields already in the report — no server change.
  const avgSpeedKmh = report.timeSpanS && report.timeSpanS > 0 ? (report.movementDistanceM / report.timeSpanS) * 3.6 : null
  return (
    <div className="mt-2 border-t border-border pt-3 flex flex-col gap-3 text-xs">
      {!report.looksUsable && (
        <p className="text-muted">This recording has no paddle in it. It may have been started on land, or stopped before you set off.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Time" value={fmtDur(report.timeSpanS)} />
        <Stat label="Distance" value={fmtDist(report.movementDistanceM)} />
        <Stat label="Average speed" value={avgSpeedKmh == null ? '—' : `${avgSpeedKmh.toFixed(1)} km/h`} />
        <Stat label="Stroke rate" value={sr.spm == null ? '—' : `${sr.spm} spm`} />
      </div>
      <p className="text-muted leading-relaxed">{sr.text}{gps ? ` ${gps}` : ''}</p>

      {attitude?.available && (
        <div>
          <div className="text-[10px] text-muted tracking-widest uppercase mb-1">Boat motion</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Side-to-side roll" value={`${attitude.rollRmsDeg}°`} />
            <Stat label="Bow-to-stern pitch" value={`${attitude.pitchRmsDeg}°`} />
            <Stat label="Evenness" value={attitude.symmetry ? `${Math.abs(attitude.symmetry.imbalancePct).toFixed(0)}% uneven` : '—'} />
          </div>
          <p className="text-muted leading-relaxed mt-2">
            Rowing: aim for little roll. Kayak: roll is fine if it&apos;s even.
            {!attitude.axisConfident && ' Roll and pitch were hard to tell apart in this recording.'}
          </p>
        </div>
      )}

      {/* Always offered, never gated on the motion data being there: the charts
          page is how you find out WHETHER this recording has motion. */}
      <div>
        <Link href={`/devices/${deviceId}/${sessionId}`} className="text-primary">BOAT MOTION CHARTS →</Link>
      </div>

      <TechnicalDetails report={report} cadence={cadence} attitude={attitude} />
    </div>
  )
}
export default function DeviceDetailPage() {
  const params = useParams<{ deviceId: string }>()
  const deviceId = (params?.deviceId ?? '').toUpperCase()
  const [device, setDevice] = useState<DeviceView | null | undefined>(undefined)
  const [sessions, setSessions] = useState<DeviceSessionMeta[] | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const [reports, setReports] = useState<Record<string, SessionReport | 'loading' | 'error'>>({})
  // Which recordings became paddles: those open in Paddles, where their boat
  // motion lives too (one-paddle.md, phase 3).
  const paddleOf = trpc.paddles.byRecording.useQuery(undefined, { retry: false }).data ?? {}

  useEffect(() => {
    if (!deviceId) return
    // Both lists are already owner-filtered server-side, so filtering by
    // deviceId here cannot widen what the viewer can see — a deviceId they
    // don't own simply yields nothing.
    fetch('/api/account/devices')
      .then(r => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices: DeviceView[] }) => setDevice((d.devices ?? []).find(x => x.deviceId === deviceId) ?? null))
      .catch(() => setDevice(null))
    fetch('/api/account/devices/sessions')
      .then(r => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions: DeviceSessionMeta[] }) => setSessions((d.sessions ?? []).filter(s => s.deviceId === deviceId)))
      .catch(() => setSessions([]))
  }, [deviceId])

  const toggle = async (s: DeviceSessionMeta) => {
    const key = s.sessionId
    if (open === key) { setOpen(null); return }
    setOpen(key)
    if (reports[key] && reports[key] !== 'error') return
    setReports(r => ({ ...r, [key]: 'loading' }))
    try {
      const res = await fetch(`/api/account/devices/sessions/${key}?deviceId=${encodeURIComponent(s.deviceId)}`)
      const d = await res.json()
      setReports(r => ({
        ...r,
        [key]: res.ok && d.report
          ? { report: d.report, cadence: d.cadence ?? null, attitude: d.attitude ?? null }
          : 'error',
      }))
    } catch { setReports(r => ({ ...r, [key]: 'error' })) }
  }

  const title = device?.name ?? `Tracker ${deviceId}`

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/devices" className="tt-nav-link text-sm shrink-0">← DEVICES</Link>} />
      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-bold text-fg tracking-widest uppercase">{title}</h1>
          <p className="text-xs text-muted mt-1 tabular">
            {deviceId}
            {device?.model ? ` · ${device.model}` : ''}
            {device?.firmware ? ` · firmware ${device.firmware}` : ''}
            {device ? ` · last seen ${fmtDay(device.lastSeenAt)}` : ''}
          </p>
          {device === null && (
            <p className="text-xs text-muted mt-2 border border-border bg-surface px-3 py-2">
              This tracker is no longer on your account, but its recordings are still yours.{' '}
              <Link href="/devices#add" className="text-primary">Add it again</Link> to get new ones.
            </p>
          )}
          <p className="text-sm text-muted mt-2">
            Everything this tracker has recorded. Each paddle opens in Paddles; a recording where the boat
            barely moved (a test at home) stays here.
          </p>
          {device && (
            <p className="text-sm text-muted mt-1">
              Away from WiFi? <Link href="/devices/bluetooth" className="text-primary">Sync over Bluetooth</Link>.
            </p>
          )}
        </div>

        {sessions === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted">No recordings from this tracker yet. It uploads them by itself when it’s switched on in range of your WiFi. <Link href="/guide/upload" className="text-primary">How uploading works</Link>.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map(s => paddleOf[s.sessionId] ? (
              <Link key={s.sessionId} href={`/paddles/${paddleOf[s.sessionId]}`}
                className="border border-border px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface transition-colors">
                <span className="min-w-0">
                  <span className="block text-sm text-fg truncate">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                  <span className="block text-xs text-muted tabular truncate">paddle{s.motion ? ' · with boat motion' : ''}</span>
                </span>
                <span className="text-muted shrink-0" aria-hidden="true">→</span>
              </Link>
            ) : (
              <div key={s.sessionId} className="border border-border">
                <button onClick={() => toggle(s)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface transition-colors">
                  <span className="min-w-0">
                    <span className="block text-sm text-fg truncate">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                    <span className="block text-xs text-muted tabular truncate">
                      {(s.distanceMetres ?? 0) < MIN_PADDLE_METRES ? 'not a paddle: the boat barely moved' : 'not a paddle yet'} · {s.filename}
                    </span>
                  </span>
                  <span className="text-muted text-lg leading-none shrink-0">{open === s.sessionId ? '–' : '+'}</span>
                </button>
                {open === s.sessionId && (
                  <div className="px-4 pb-4">
                    {reports[s.sessionId] === 'loading' && <p className="text-xs text-muted">Loading…</p>}
                    {reports[s.sessionId] === 'error' && <p className="text-xs text-red">Couldn’t read this recording. Please try again.</p>}
                    {reports[s.sessionId] && reports[s.sessionId] !== 'loading' && reports[s.sessionId] !== 'error' && (
                      <Report {...(reports[s.sessionId] as SessionReport)} sessionId={s.sessionId} deviceId={s.deviceId} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {device && (
          <div className="border-t border-border pt-6">
            <RemoveTrackerButton deviceId={deviceId} />
          </div>
        )}
      </div>
    </main>
  )
}
