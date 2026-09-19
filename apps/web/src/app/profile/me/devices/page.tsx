'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import type { DeviceSessionMeta } from '@/lib/devices'
import { type DeviceSummary, type DeviceView, deviceSummaries, fmtDate, fmtDay, fmtDist } from '@/lib/device-view'

// MY DEVICES — the tracker-first view. This page used to be a flat list of every
// upload across every device, with a raw hex id on each row; with more than one
// tracker on an account that stops being readable, so the device is now the unit
// and its uploads live one level down at /profile/me/devices/d/<deviceId>.

export default function MyDevicesPage() {
  const [rows, setRows] = useState<DeviceSummary[] | undefined>(undefined)

  useEffect(() => {
    Promise.all([
      fetch('/api/account/devices').then(r => (r.ok ? r.json() : { devices: [] })).catch(() => ({ devices: [] })),
      fetch('/api/account/devices/sessions').then(r => (r.ok ? r.json() : { sessions: [] })).catch(() => ({ sessions: [] })),
    ]).then(([d, s]: [{ devices?: DeviceView[] }, { sessions?: DeviceSessionMeta[] }]) => {
      setRows(deviceSummaries(d.devices ?? [], s.sessions ?? []))
    })
  }, [])

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/profile/me/settings" className="tt-nav-link text-sm shrink-0">← ACCOUNT</Link>} />
      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-wide">My devices</h1>
          <p className="text-sm text-muted mt-1">
            Your paddlesnitch trackers and what each one has uploaded. Open a tracker to inspect its
            raw data — every column, and what we can (and can&apos;t) make of it.
          </p>
        </div>

        {rows === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="border border-border bg-surface px-4 py-6 text-sm text-muted leading-relaxed">
            No trackers yet. A paddlesnitch tracker records a paddle and uploads it over WiFi by
            itself — no phone, no card shuffling. Pair one in{' '}
            <Link href="/profile/me/settings" className="text-primary">Account → Devices</Link> by
            entering the 6-character code it shows on its screen.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(d => (
              <Link
                key={d.deviceId}
                href={`/profile/me/devices/d/${d.deviceId}`}
                className="border border-border px-4 py-3 flex items-center justify-between gap-4 hover:bg-surface transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-fg truncate">
                    {d.name}
                    {!d.linked && <span className="ml-2 text-[10px] tracking-widest uppercase text-muted">not linked</span>}
                  </span>
                  <span className="block text-xs text-muted tabular">
                    {d.deviceId}
                    {d.model ? ` · ${d.model}` : ''}
                    {d.firmware ? ` · fw ${d.firmware}` : ''}
                    {d.linked ? ` · last seen ${fmtDay(d.lastSeenAt)}` : ''}
                  </span>
                  <span className="block text-xs text-muted tabular mt-1">
                    {d.sessions === 0
                      ? 'no uploads yet'
                      : `${d.sessions} session${d.sessions === 1 ? '' : 's'}${d.totalDistanceM > 0 ? ` · ${fmtDist(d.totalDistanceM)}` : ''}${d.motionSessions > 0 ? ` · ${d.motionSessions} with motion` : ''}`}
                    {d.latestAt ? ` · latest ${fmtDate(d.latestAt)}` : ''}
                  </span>
                </span>
                <span className="text-muted shrink-0" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        )}

        <p className="text-xs text-muted">
          Pair or revoke a tracker in <Link href="/profile/me/settings" className="text-primary">Account → Devices</Link>.
          Uploaded sessions also appear as <span className="text-fg">MY TRACKER</span> in{' '}
          <Link href="/paddles/library" className="text-primary">My paddles</Link>.
        </p>
      </div>
    </main>
  )
}
