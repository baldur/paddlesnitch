'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Chevron, EmptyState, cardClass, cardLinkClass } from '@paddlesnitch/ui/Card'
import RemoveTrackerButton from '@/components/devices/RemoveTrackerButton'
import TechnicalDetails, { Stat } from '@/components/devices/TechnicalDetails'
import { strokeRateCopy, gpsCopy } from '@/lib/tracker-copy'
import type { DeviceSessionMeta } from '@/lib/devices'
import { type DeviceView, fmtDate, fmtDay, fmtDist, fmtDur, isPhoneDeviceId } from '@/lib/device-view'
import { trpc } from '@/lib/trpc'
import type { DeviceDataReport } from '@paddlesnitch/timing/device'
import type { CadenceReport } from '@paddlesnitch/timing/cadence'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

// One tracker's recordings. Each opens to a plain summary (time, distance,
// speed, stroke rate, boat motion) with the engineering diagnostics behind a
// "Technical details" toggle.

type SessionReport = {
  report: DeviceDataReport
  cadence: CadenceReport | null
  attitude: AttitudeReport | null
  noPaddle?: string | null
  fromMotion?: string | null
}

function Report({ report, cadence, attitude, noPaddle, fromMotion, sessionId, deviceId }: SessionReport & { sessionId: string; deviceId: string }) {
  const sr = strokeRateCopy(report, cadence)
  const gps = gpsCopy(report)
  // Derived from the fields already in the report — no server change.
  const avgSpeedKmh = report.timeSpanS && report.timeSpanS > 0 ? (report.movementDistanceM / report.timeSpanS) * 3.6 : null
  return (
    <div className="mt-2 border-t border-border pt-3 flex flex-col gap-3 text-sm">
      {noPaddle ? <p className="text-base text-fg">{noPaddle}{fromMotion ? ` ${fromMotion}` : ''}</p> : !report.looksUsable && (
        <p className="text-base text-muted">This recording has no paddle in it. It may have been started on land, or stopped before you set off.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Time" value={fmtDur(report.timeSpanS)} />
        <Stat label="Distance" value={fmtDist(report.movementDistanceM)} />
        <Stat label="Average speed" value={avgSpeedKmh == null ? '—' : `${avgSpeedKmh.toFixed(1)} km/h`} />
        <Stat label="Stroke rate" value={sr.spm == null ? '—' : `${sr.spm} spm`} />
      </div>
      <p className="text-muted">{sr.text}{gps ? ` ${gps}` : ''}</p>

      {attitude?.available && (
        <div>
          <h3 className="text-base font-semibold text-fg mb-2">Boat motion</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Stat label="Side-to-side roll" value={`${attitude.rollRmsDeg}°`} />
            <Stat label="Bow-to-stern pitch" value={`${attitude.pitchRmsDeg}°`} />
            <Stat label="Evenness" value={attitude.symmetry ? `${Math.abs(attitude.symmetry.imbalancePct).toFixed(0)}% uneven` : '—'} />
          </div>
          <p className="text-muted mt-2">
            Rowing: aim for little roll. Kayak: roll is fine if it&apos;s even.
            {!attitude.axisConfident && ' Roll and pitch were hard to tell apart in this recording.'}
          </p>
        </div>
      )}

      {/* Always offered, never gated on the motion data being there: the charts
          page is how you find out WHETHER this recording has motion. */}
      <div>
        <Link href={`/devices/${deviceId}/${sessionId}`} className={buttonClass('quiet', 'md', '-ml-4 text-primary-text')}>Boat motion charts →</Link>
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

  // A phone that records with the app (C3): no firmware, Bluetooth or WiFi.
  const phone = isPhoneDeviceId(deviceId)
  const title = device?.name ?? (phone ? 'Phone' : `Tracker ${deviceId}`)

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/devices" className="tt-nav-link">← Devices</Link>} />
      <Page>
        <PageHeader
          title={title}
          description={`Everything this ${phone ? 'phone' : 'tracker'} has recorded. Each paddle opens in Paddles; a recording where the boat barely moved (a test at home) stays here.`}
        />
        <div className="flex flex-col gap-3 -mt-4">
          <p className="text-sm text-muted tabular">
            {deviceId}
            {/* A phone's name already says what it is, and it only calls in after a paddle. */}
            {!phone && device?.model ? ` · ${device.model}` : ''}
            {device?.firmware ? ` · firmware ${device.firmware}` : ''}
            {phone && device ? ` · added ${fmtDay(device.linkedAt)}` : ''}
            {!phone && device ? ` · last seen ${fmtDay(device.lastSeenAt)}` : ''}
          </p>
          {device === null && phone && (
            <p className={`${cardClass} text-base text-muted p-4`}>
              This phone is no longer on your account, but its recordings are still yours.
              Record on that phone with the app to add it again.
            </p>
          )}
          {device === null && !phone && (
            <p className={`${cardClass} text-base text-muted p-4`}>
              This tracker is no longer on your account, but its recordings are still yours.{' '}
              <Link href="/devices#add" className="tt-link">Add it again</Link> to get new ones.
            </p>
          )}
          {device && !phone && (
            <p className="text-sm text-muted">
              Away from WiFi? <Link href="/devices/bluetooth" className="tt-link">Sync over Bluetooth</Link>.
            </p>
          )}
        </div>

        <Section title="Recordings">
          {sessions === undefined ? (
            <p className="text-base text-muted">Loading…</p>
          ) : sessions.length === 0 ? (
            phone ? (
              <EmptyState title="No recordings yet" body="The app uploads each recording after you stop it." />
            ) : (
              <EmptyState
                title="No recordings yet"
                body="The tracker uploads them by itself when it's switched on in range of your WiFi."
                action={<Link href="/guide/upload" className={buttonClass('secondary')}>How uploading works</Link>}
              />
            )
          ) : (
            <div className="flex flex-col gap-2">
              {sessions.map(s => paddleOf[s.sessionId] ? (
                <Link key={s.sessionId} href={`/paddles/${paddleOf[s.sessionId]}`}
                  className={`${cardLinkClass} px-4 py-3 flex items-center justify-between gap-4`}>
                  <span className="min-w-0">
                    <span className="block text-base text-fg truncate tabular">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                    <span className="block text-sm text-muted truncate">paddle{s.motion ? ' · with boat motion' : ''}</span>
                  </span>
                  <Chevron />
                </Link>
              ) : (
                <div key={s.sessionId} className={cardClass}>
                  <button onClick={() => toggle(s)} aria-expanded={open === s.sessionId}
                    className="w-full text-left px-4 py-3 min-h-11 flex items-center justify-between gap-4 rounded-control hover:bg-surface-2 transition-colors">
                    <span className="min-w-0">
                      <span className="block text-base text-fg truncate tabular">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                      <span className="block text-sm text-muted truncate">
                        not a paddle: open to see why · <span className="tabular">{s.filename}</span>
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-muted text-xl leading-none shrink-0">{open === s.sessionId ? '–' : '+'}</span>
                  </button>
                  {open === s.sessionId && (
                    <div className="px-4 pb-4">
                      {reports[s.sessionId] === 'loading' && <p className="text-sm text-muted">Loading…</p>}
                      {reports[s.sessionId] === 'error' && <p className="text-sm text-red">Couldn’t read this recording. Please try again.</p>}
                      {reports[s.sessionId] && reports[s.sessionId] !== 'loading' && reports[s.sessionId] !== 'error' && (
                        <Report {...(reports[s.sessionId] as SessionReport)} sessionId={s.sessionId} deviceId={s.deviceId} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {device && (
          <div className="border-t border-border pt-6">
            <RemoveTrackerButton deviceId={deviceId} phone={phone} />
          </div>
        )}
      </Page>
    </main>
  )
}
