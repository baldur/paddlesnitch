'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import RemoveTrackerButton from '@/components/devices/RemoveTrackerButton'
import { strokeRateCopy, gpsCopy } from '@/lib/tracker-copy'
import type { DeviceSessionMeta } from '@/lib/devices'
import { type DeviceView, fmtDate, fmtDay, fmtDist, fmtDur } from '@/lib/device-view'
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
  const sampleRateHz = report.timeSpanS && report.timeSpanS > 0 ? report.rows / report.timeSpanS : null
  return (
    <div className="mt-2 border-t border-border pt-3 flex flex-col gap-3 text-xs">
      {!report.looksUsable && (
        <p className="text-muted">This recording has no paddle in it. The tracker records whenever it&apos;s switched on.</p>
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

      <details className="border border-border bg-surface px-3 py-2">
        <summary className="cursor-pointer text-[10px] text-muted tracking-widest uppercase">Technical details</summary>
        <div className="flex flex-col gap-3 mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Rows" value={String(report.rows)} />
            <Stat label="With GPS fix" value={`${report.fixedRows} / ${report.rows}`} />
            <Stat label="Rows captured" value={`${(report.capture.capturedFraction * 100).toFixed(1)}%`} />
            <Stat label="Dropped rows" value={report.capture.gaps === 0 ? 'none' : `${report.capture.missingRows} in ${report.capture.gaps} gap${report.capture.gaps === 1 ? '' : 's'}`} />
            <Stat label="Sample rate" value={sampleRateHz == null ? '—' : `${sampleRateHz.toFixed(1)} Hz`} />
            <Stat label="Satellites" value={report.gnss.satsFirst == null ? '—' : `${report.gnss.satsFirst} → ${report.gnss.satsLast}`} />
            <Stat label="HDOP" value={report.gnss.hdopFirst == null ? '—' : `${report.gnss.hdopFirst} → ${report.gnss.hdopLast}`} />
            <Stat label="Motion sensors" value={`${report.hasImu ? 'accel' : '—'}${report.hasGyro ? ' + gyro' : ''}`} />
          </div>
          {report.gnss.altitudeSpreadM != null && report.gnss.altitudeSpreadM > 10 && (
            <p className="text-muted">Altitude wandered {report.gnss.altitudeSpreadM} m. GPS altitude is noise at this scale, so nothing uses it.</p>
          )}
          <p className="text-muted leading-relaxed">Stroke rate: {report.strokeRate.reason}{cadence && !cadence.available ? ` Motion data: ${cadence.reason}` : ''}</p>
          {report.strokeRate.evidence && <p className="text-muted leading-relaxed">{report.strokeRate.evidence}</p>}
          {attitude?.available && (
            <p className="text-muted">Roll range {attitude.rollP5Deg}° … {attitude.rollP95Deg}°{attitude.symmetry ? `; one side to ${attitude.symmetry.sideADeg}°, the other to ${attitude.symmetry.sideBDeg}°` : ''}.</p>
          )}
          {report.motion && report.motion.gyroPeakMax != null && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Rotation, median" value={`${report.motion.gyroPeakMedian ?? '—'} dps`} />
              <Stat label="Paddling ceiling (p99)" value={report.motion.gyroPeakP99Moving == null ? '—' : `${report.motion.gyroPeakP99Moving} dps`} />
              <Stat label="Handling peak" value={report.motion.gyroPeakMaxStationary == null ? '—' : `${report.motion.gyroPeakMaxStationary} dps`} />
              <Stat label="Peak acceleration" value={report.motion.accelPeakMax == null ? '—' : `${report.motion.accelPeakMax} g`} />
            </div>
          )}
          {report.deadColumns.length > 0 && (
            <p className="text-muted leading-relaxed">
              Empty in this recording: {report.deadColumns.map(c => `${c.name} (${c.kind === 'zero' ? 'always 0' : 'always empty'})`).join(', ')}.
              This is often normal, for example battery reads 0 with no battery fitted.
            </p>
          )}
          <div>
            <div className="text-[10px] text-muted tracking-widest uppercase mb-1">Columns ({report.columns.length})</div>
            <div className="flex flex-wrap gap-1">
              {report.columns.map(c => {
                const dead = report.deadColumns.find(d => d.name === c)
                return (
                  <span
                    key={c}
                    title={dead ? `Present in every row but ${dead.kind === 'zero' ? 'always 0' : 'always empty'}` : undefined}
                    className={`border px-2 py-0.5 tabular text-[11px] ${dead ? 'border-red/40 bg-surface text-red' : 'border-border bg-surface'}`}
                  >{c}</span>
                )
              })}
            </div>
          </div>
          {report.sampleRows.length > 0 && (
            <div className="overflow-x-auto">
              <div className="text-[10px] text-muted tracking-widest uppercase mb-1">First rows</div>
              <table className="text-[11px] tabular border border-border">
                <thead><tr>{report.columns.map(c => <th key={c} className="border-b border-border px-2 py-1 text-left text-muted font-normal whitespace-nowrap">{c}</th>)}</tr></thead>
                <tbody>
                  {report.sampleRows.map((row, i) => (
                    <tr key={i}>{report.columns.map(c => <td key={c} className="px-2 py-1 whitespace-nowrap text-fg">{row[c] || <span className="text-muted">·</span>}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-surface px-2 py-1"><div className="text-[9px] text-muted tracking-widest uppercase">{label}</div><div className="text-fg tabular">{value}</div></div>
}

export default function DeviceDetailPage() {
  const params = useParams<{ deviceId: string }>()
  const deviceId = (params?.deviceId ?? '').toUpperCase()
  const [device, setDevice] = useState<DeviceView | null | undefined>(undefined)
  const [sessions, setSessions] = useState<DeviceSessionMeta[] | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const [reports, setReports] = useState<Record<string, SessionReport | 'loading' | 'error'>>({})

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
          <p className="text-sm text-muted mt-2">Everything this tracker has recorded. Tap one for its details.</p>
        </div>

        {sessions === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted">No recordings from this tracker yet. It uploads over WiFi when you hold SYNC on the tracker.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map(s => (
              <div key={s.sessionId} className="border border-border">
                <button onClick={() => toggle(s)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface transition-colors">
                  <span className="min-w-0">
                    <span className="block text-sm text-fg truncate">{fmtDate(s.startedAt ?? s.uploadedAt)}{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                    <span className="block text-xs text-muted tabular truncate">{s.filename}{s.motion ? ' · with boat motion' : ''}</span>
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
