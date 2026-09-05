'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import type { DeviceSessionMeta } from '@/lib/devices'
import type { DeviceDataReport } from '@paddlesnitch/timing/device'

const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso.slice(0, 16) } }
const fmtDist = (m?: number) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`)
const fmtDur = (s?: number | null) => { if (s == null) return '—'; const m = Math.floor(s / 60), sec = s % 60; return m ? `${m}m ${sec}s` : `${sec}s` }

function Report({ report }: { report: DeviceDataReport }) {
  const sr = report.strokeRate
  return (
    <div className="mt-2 border-t border-border pt-3 flex flex-col gap-3 text-xs">
      {/* what we can make of it */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Rows" value={String(report.rows)} />
        <Stat label="With GPS fix" value={`${report.fixedRows} / ${report.rows}`} />
        <Stat label="Duration" value={fmtDur(report.timeSpanS)} />
        <Stat label="Distance (gated)" value={fmtDist(report.movementDistanceM)} />
      </div>

      <div className={`border px-3 py-2 ${sr.available ? 'border-green bg-green/10 text-green' : 'border-border bg-surface text-muted'}`}>
        <span className="tracking-widest text-[10px] uppercase">Stroke rate</span>{' '}
        <span className={sr.available ? 'text-green' : 'text-fg'}>{sr.available ? 'available' : 'not derivable'}</span>
        <p className="mt-1 leading-relaxed">{sr.reason}</p>
      </div>

      {!report.looksUsable && (
        <p className="text-muted">This session doesn&apos;t contain a usable paddle (likely a bench/acquisition log). That&apos;s normal — the device records whenever it has power.</p>
      )}

      {/* every column, and a few raw rows */}
      <div>
        <div className="text-[10px] text-muted tracking-widest uppercase mb-1">Columns ({report.columns.length})</div>
        <div className="flex flex-wrap gap-1">
          {report.columns.map(c => <span key={c} className="border border-border bg-surface px-2 py-0.5 tabular text-[11px]">{c}</span>)}
        </div>
      </div>

      {report.sampleRows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] text-muted tracking-widest uppercase mb-1">First rows (raw)</div>
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
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-surface px-2 py-1"><div className="text-[9px] text-muted tracking-widest uppercase">{label}</div><div className="text-fg tabular">{value}</div></div>
}

export default function DevicesDataPage() {
  const [sessions, setSessions] = useState<DeviceSessionMeta[] | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const [reports, setReports] = useState<Record<string, DeviceDataReport | 'loading' | 'error'>>({})

  useEffect(() => {
    fetch('/api/account/devices/sessions')
      .then(r => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions: DeviceSessionMeta[] }) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
  }, [])

  const toggle = async (s: DeviceSessionMeta) => {
    const key = s.sessionId
    if (open === key) { setOpen(null); return }
    setOpen(key)
    if (reports[key] && reports[key] !== 'error') return
    setReports(r => ({ ...r, [key]: 'loading' }))
    try {
      const res = await fetch(`/api/account/devices/sessions/${key}?deviceId=${encodeURIComponent(s.deviceId)}`)
      const d = await res.json()
      setReports(r => ({ ...r, [key]: res.ok && d.report ? d.report : 'error' }))
    } catch { setReports(r => ({ ...r, [key]: 'error' })) }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/profile/me/settings" className="tt-nav-link text-sm shrink-0">← ACCOUNT</Link>} />
      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-wide">Device data</h1>
          <p className="text-sm text-muted mt-1">Everything your tracker has uploaded. Expand a session to see all its columns and what we can (and can&apos;t) make of it.</p>
        </div>

        {sessions === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted">No device uploads yet. Link a tracker in <Link href="/profile/me/settings" className="text-primary">Account</Link>.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map(s => (
              <div key={s.sessionId} className="border border-border">
                <button onClick={() => toggle(s)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface transition-colors">
                  <span className="min-w-0">
                    <span className="block text-sm text-fg truncate">{s.filename}</span>
                    <span className="block text-xs text-muted tabular">{s.deviceId} · {fmtDate(s.startedAt ?? s.uploadedAt)} · {s.points} pts{s.distanceMetres ? ` · ${fmtDist(s.distanceMetres)}` : ''}</span>
                  </span>
                  <span className="text-muted text-lg leading-none shrink-0">{open === s.sessionId ? '–' : '+'}</span>
                </button>
                {open === s.sessionId && (
                  <div className="px-4 pb-4">
                    {reports[s.sessionId] === 'loading' && <p className="text-xs text-muted">Reading…</p>}
                    {reports[s.sessionId] === 'error' && <p className="text-xs text-red">Could not read this session.</p>}
                    {reports[s.sessionId] && reports[s.sessionId] !== 'loading' && reports[s.sessionId] !== 'error' && (
                      <Report report={reports[s.sessionId] as DeviceDataReport} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
