'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import AddTrackerForm from '@/components/devices/AddTrackerForm'
import type { DeviceSessionMeta } from '@/lib/devices'
import { setupProgress } from '@/lib/guide'
import { type DeviceSummary, type DeviceView, deviceSummaries, deviceIsBehind, deviceIsQuiet, fmtAgo, fmtDate, fmtDist, crashNote } from '@/lib/device-view'

// DEVICES: your trackers, one card each (the tracker is the unit; its
// recordings live one level down at /devices/<deviceId>), and the box to add a
// tracker. Adding used to live on the account page and viewing here, and each
// page sent you to the other; removing a tracker is on its own page.

// Until the first recording arrives: what's done and what's next, each linking
// to the guide step for it.
function GettingStarted({ rows }: { rows: DeviceSummary[] }) {
  const { items, complete } = setupProgress(rows)
  if (complete) return null
  const next = items.find(i => !i.done)
  return (
    <section className="border border-primary px-4 py-4 flex flex-col gap-2" aria-label="Getting started">
      <h2 className="text-xs text-fg tracking-widest uppercase">Getting started</h2>
      <ol className="flex flex-col gap-1 text-sm">
        {items.map(i => (
          <li key={i.label} className="flex gap-2">
            <span aria-hidden="true" className={i.done ? 'text-green' : 'text-muted'}>{i.done ? '✓' : '○'}</span>
            {i.done
              ? <span className="text-muted line-through">{i.label}</span>
              : <Link href={i.href} className={i === next ? 'text-primary' : 'text-fg'}>{i.label}{i === next ? ' →' : ''}</Link>}
            <span className="sr-only">{i.done ? '(done)' : '(to do)'}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function DevicesPage() {
  const [rows, setRows] = useState<DeviceSummary[] | undefined>(undefined)
  // What the stable channel offers, so a version can be shown as up-to-date or
  // behind rather than as a number the reader has to calibrate themselves.
  const [stable, setStable] = useState<string | null>(null)

  const load = () => {
    Promise.all([
      fetch('/api/account/devices').then(r => (r.ok ? r.json() : { devices: [] })).catch(() => ({ devices: [] })),
      fetch('/api/account/devices/sessions').then(r => (r.ok ? r.json() : { sessions: [] })).catch(() => ({ sessions: [] })),
    ]).then(([d, s]: [{ devices?: DeviceView[]; stableVersion?: string | null }, { sessions?: DeviceSessionMeta[] }]) => {
      setStable(d.stableVersion ?? null)
      setRows(deviceSummaries(d.devices ?? [], s.sessions ?? []))
    })
  }
  useEffect(load, [])

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/" className="tt-nav-link text-sm">← HOME</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">DEVICES</span>
          </>
        }
      />
      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-bold text-fg tracking-widest">DEVICES</h1>
          <p className="text-sm text-muted mt-1">
            Your paddlesnitch trackers and what each one has recorded. Setting one up?{' '}
            <Link href="/guide" className="text-primary">Follow the guide</Link>.
          </p>
        </div>

        {rows !== undefined && <GettingStarted rows={rows} />}

        {rows === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="border border-border bg-surface px-4 py-6 text-sm text-muted leading-relaxed">
            No trackers yet. A paddlesnitch tracker records your paddle and uploads it over WiFi on
            its own. Add one below.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(d => (
              <Link
                key={d.deviceId}
                href={`/devices/${d.deviceId}`}
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
                  </span>
                  {d.linked && (
                    <span className="block text-xs tabular mt-1">
                      {/* Running version, and whether it is the released one.
                          Both come from what the device actually reported on its
                          last request, not from what it claimed when paired. */}
                      <span className="text-muted">firmware </span>
                      <span className="text-fg">{d.firmware || 'unknown'}</span>
                      {deviceIsBehind(d.firmware, stable) === true && (
                        <span className="text-split"> · update pending ({stable})</span>
                      )}
                      {deviceIsBehind(d.firmware, stable) === false && (
                        <span className="text-green"> · up to date</span>
                      )}
                      <span className="text-muted"> · seen </span>
                      <span className={deviceIsQuiet(d.lastSeenAt) ? 'text-red' : 'text-fg'}>
                        {fmtAgo(d.lastSeenAt)}
                      </span>
                      {/* Reported by the tracker on the start after the crash. */}
                      {crashNote(d.lastCrash) && <span className="text-red"> · {crashNote(d.lastCrash)}</span>}
                    </span>
                  )}
                  <span className="block text-xs text-muted tabular mt-1">
                    {d.sessions === 0
                      ? 'no recordings yet'
                      : `${d.sessions} recording${d.sessions === 1 ? '' : 's'}${d.totalDistanceM > 0 ? ` · ${fmtDist(d.totalDistanceM)}` : ''}${d.motionSessions > 0 ? ` · ${d.motionSessions} with boat motion` : ''}`}
                    {d.latestAt ? ` · latest ${fmtDate(d.latestAt)}` : ''}
                  </span>
                </span>
                <span className="text-muted shrink-0" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        )}

        <section className="border border-border bg-surface px-4 py-4 flex flex-col gap-2" aria-label="Bluetooth">
          <h2 className="text-xs text-fg tracking-widest uppercase">Bluetooth</h2>
          <p className="text-sm text-muted">
            Away from WiFi? Sync a tracker through this phone or computer, or add one to your account without WiFi.
          </p>
          <div>
            <Link href="/devices/bluetooth" className="inline-block px-4 py-2 bg-primary text-white text-sm tracking-widest">
              SYNC OVER BLUETOOTH
            </Link>
          </div>
          <p className="text-xs text-muted">
            Chrome or Edge, on Android or a computer. Bluetooth is off on the tracker until you turn it on.{' '}
            <Link href="/guide/bluetooth" className="text-primary">How</Link>.
          </p>
        </section>

        <div className="border-t border-border pt-6">
          <AddTrackerForm onAdded={load} />
        </div>

        <p className="text-xs text-muted">
          To analyse a recording, <Link href="/paddles/new" className="text-primary">add a paddle</Link> and
          choose it from your tracker. To remove a tracker, open it.
        </p>
      </div>
    </main>
  )
}
