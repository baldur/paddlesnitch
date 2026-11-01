'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import AddTrackerForm from '@/components/devices/AddTrackerForm'
import type { DeviceSessionMeta } from '@/lib/devices'
import { setupProgress } from '@/lib/guide'
import { fmtDay } from '@paddlesnitch/core/format'
import { trpc } from '@/lib/trpc'
import { PREFILLED_FRESH_MS } from '@/lib/fresh'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { Badge, Chevron, EmptyState, cardClass, cardLinkClass } from '@paddlesnitch/ui/Card'
import { type DeviceSummary, type DeviceView, deviceSummaries, deviceIsBehind, deviceIsQuiet, fmtAgo, fmtDist, crashNote, isPhoneDeviceId } from '@/lib/device-view'

// DEVICES: your trackers, one card each (the tracker is the unit; its
// recordings live one level down at /devices/<deviceId>), and the box to add a
// tracker. Adding used to live on the account page and viewing here, and each
// page sent you to the other; removing a tracker is on its own page.

// Until the first recording arrives: what's done and what's next, each linking
// to the guide step for it.
function GettingStarted({ rows, hasTrackerPaddle }: { rows: DeviceSummary[]; hasTrackerPaddle: boolean }) {
  const { items, complete } = setupProgress(rows, hasTrackerPaddle)
  if (complete) return null
  const next = items.find(i => !i.done)
  // One checklist, three states drawn the same way: done (✓), next (the one
  // to do now, highlighted) and later (muted). Each step links to its guide page.
  return (
    <Section title="Getting started" className={`${cardClass} p-4 sm:p-5`}>
      <ol className="flex flex-col">
        {items.map((i, n) => {
          const state = i.done ? 'done' : i === next ? 'next' : 'later'
          return (
            <li key={i.label}>
              <Link href={i.href} className="flex items-center gap-3 min-h-11 py-1 group">
                <span
                  aria-hidden="true"
                  className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm tabular ${
                    state === 'done' ? 'bg-green/15 text-green'
                      : state === 'next' ? 'bg-primary text-white'
                        : 'border border-border-strong text-muted'
                  }`}
                >
                  {state === 'done' ? '✓' : n + 1}
                </span>
                <span className={`text-base group-hover:underline ${state === 'next' ? 'text-fg font-medium' : 'text-muted'}`}>{i.label}</span>
                {state === 'next' && <Badge tone="primary">Next</Badge>}
                <span className="sr-only">{i.done ? '(done)' : '(to do)'}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

// What the server put in the first HTML (app/devices/page.tsx); without it the
// page loads its own, as it always did.
export type DevicesInitial = { devices: DeviceView[]; stableVersion: string | null; sessions: DeviceSessionMeta[] }

export default function DevicesView({ initial }: { initial?: DevicesInitial }) {
  const [rows, setRows] = useState<DeviceSummary[] | undefined>(() => initial && deviceSummaries(initial.devices, initial.sessions))
  // Whether any recording has become a paddle: what "set up" means for the
  // getting-started checklist.
  const hasTrackerPaddle = Object.keys(trpc.paddles.byRecording.useQuery(undefined, { retry: false, staleTime: PREFILLED_FRESH_MS }).data ?? {}).length > 0
  // What the stable channel offers, so a version can be shown as up-to-date or
  // behind rather than as a number the reader has to calibrate themselves.
  const [stable, setStable] = useState<string | null>(initial?.stableVersion ?? null)

  // A failed load is said as such: treating it as "no trackers" told owners
  // they had none and offered to add one again.
  const [loadFailed, setLoadFailed] = useState(false)
  const load = () => {
    const get = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    Promise.all([get('/api/account/devices'), get('/api/account/devices/sessions')])
      .then(([d, s]: [{ devices?: DeviceView[]; stableVersion?: string | null }, { sessions?: DeviceSessionMeta[] }]) => {
        setLoadFailed(false)
        setStable(d.stableVersion ?? null)
        setRows(deviceSummaries(d.devices ?? [], s.sessions ?? []))
      })
      .catch(() => setLoadFailed(true))
  }
  useEffect(() => { if (!initial) load() }, [initial])
  // Phones that record with the app (C3) get their own list: no firmware, and
  // silence between paddles is normal for them.
  const trackerRows = rows?.filter(r => !isPhoneDeviceId(r.deviceId))
  // Newest first: an older install of the app is the one to remove.
  const phoneRows = (rows?.filter(r => isPhoneDeviceId(r.deviceId)) ?? [])
    .sort((a, b) => (b.linkedAt ?? '').localeCompare(a.linkedAt ?? ''))
  // Someone who records only on a phone sees their phones first, without the
  // tracker checklist.
  const phonesFirst = phoneRows.length > 0 && trackerRows?.length === 0
  const phonesSection = phoneRows.length > 0 && (
    <Section title="Your phones">
      <div className="flex flex-col gap-2">
        {phoneRows.map(d => (
          <Link
            key={d.deviceId}
            href={`/devices/${d.deviceId}`}
            className={`${cardLinkClass} px-4 py-3 flex items-center justify-between gap-4`}
          >
            <span className="min-w-0 flex flex-col gap-1">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-base font-medium text-fg truncate">{d.name}</span>
                {!d.linked && <Badge>removed</Badge>}
              </span>
              <span className="block text-sm text-muted tabular">
                {d.sessions === 0
                  ? 'no recordings yet'
                  : `${d.sessions} recording${d.sessions === 1 ? '' : 's'}${d.totalDistanceM > 0 ? ` · ${fmtDist(d.totalDistanceM)}` : ''}${d.motionSessions > 0 ? ` · ${d.motionSessions} with boat motion` : ''}`}
                {d.latestAt ? ` · latest ${fmtDay(d.latestAt)}` : ''}
              </span>
              {/* Each install of the app is a phone of its own, all called the
                  same: when it was added tells them apart. */}
              <span className="block text-xs text-muted tabular opacity-70">
                {d.linkedAt ? `added ${fmtDay(d.linkedAt)} · ` : ''}{d.deviceId}
              </span>
            </span>
            <Chevron />
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted">
        Phones that record with the paddlesnitch app. To remove one, open it.
      </p>
    </Section>
  )

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader />
      <Page>
        <PageHeader
          title="Devices"
          description={<>Your paddlesnitch trackers and phones, and what each one has recorded. Setting one up? <Link href="/guide" className="tt-link">Follow the guide</Link>.</>}
        />

        {trackerRows !== undefined && !phonesFirst && <GettingStarted rows={trackerRows} hasTrackerPaddle={hasTrackerPaddle} />}

        {phonesFirst && phonesSection}

        <AddTrackerForm onAdded={load} />

        <Section title="Your trackers">
          {loadFailed ? (
            <p className="text-base text-red" role="alert">
              Couldn&apos;t load your trackers and phones. <button type="button" onClick={load} className="underline min-h-11">Try again</button>.
            </p>
          ) : trackerRows === undefined ? (
            <p className="text-base text-muted">Loading…</p>
          ) : trackerRows.length === 0 ? (
            <EmptyState
              title="No trackers yet"
              body="A paddlesnitch tracker records your paddle and uploads it over WiFi by itself. Add one with the code on its screen."
              action={<Link href="/guide" className={buttonClass('secondary')}>Open the guide</Link>}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {trackerRows.map(d => (
                <Link
                  key={d.deviceId}
                  href={`/devices/${d.deviceId}`}
                  className={`${cardLinkClass} px-4 py-3 flex items-center justify-between gap-4`}
                >
                  <span className="min-w-0 flex flex-col gap-1">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-base font-medium text-fg truncate">{d.name}</span>
                      {!d.linked && <Badge>removed</Badge>}
                    </span>
                    {d.linked && (
                      <span className="block text-sm tabular">
                        {/* Running version, and whether it is the released one.
                            Both come from what the device actually reported on its
                            last request, not from what it claimed when paired. */}
                        <span className="text-muted">firmware </span>
                        <span className="text-fg">{d.firmware || 'unknown'}</span>
                        {d.beta && <span className="text-split"> · beta</span>}
                        {deviceIsBehind(d.firmware, d.targetVersion ?? stable) === true && (
                          <span className="text-split"> · update pending ({d.targetVersion ?? stable})</span>
                        )}
                        {deviceIsBehind(d.firmware, d.targetVersion ?? stable) === false && (
                          <span className="text-green"> · up to date</span>
                        )}
                        <span className="text-muted"> · seen </span>
                        {/* Written a few seconds apart on the server and in the browser:
                            a minute can tick over in between. */}
                        <span suppressHydrationWarning className={deviceIsQuiet(d.lastSeenAt) ? 'text-red' : 'text-fg'}>
                          {fmtAgo(d.lastSeenAt)}
                        </span>
                        {/* Reported by the tracker on the start after the crash. */}
                        {crashNote(d.lastCrash) && <span suppressHydrationWarning className="text-red"> · {crashNote(d.lastCrash)}</span>}
                      </span>
                    )}
                    <span className="block text-sm text-muted tabular">
                      {d.sessions === 0
                        ? 'no recordings yet'
                        : `${d.sessions} recording${d.sessions === 1 ? '' : 's'}${d.totalDistanceM > 0 ? ` · ${fmtDist(d.totalDistanceM)}` : ''}${d.motionSessions > 0 ? ` · ${d.motionSessions} with boat motion` : ''}`}
                      {d.latestAt ? ` · latest ${fmtDay(d.latestAt)}` : ''}
                    </span>
                    {/* The id is for support, not for recognising your tracker: last, small. */}
                    <span className="block text-xs text-muted tabular opacity-70">
                      {d.deviceId}{d.model ? ` · ${d.model}` : ''}
                    </span>
                  </span>
                  <Chevron />
                </Link>
              ))}
            </div>
          )}
          {!!trackerRows?.length && (
            <p className="text-sm text-muted">
              Each tracker&apos;s paddles appear in <Link href="/paddles" className="tt-link">Paddles</Link> by
              themselves. To remove a tracker, open it.
            </p>
          )}
        </Section>

        {!phonesFirst && phonesSection}

        <section className="flex flex-col gap-3" aria-label="Bluetooth">
          <h2 className="text-lg font-semibold text-fg">Bluetooth</h2>
          <p className="text-base text-muted">
            Away from WiFi? Sync a tracker through this phone or computer, or add one to your account without WiFi.
          </p>
          <div>
            <Link href="/devices/bluetooth" className={buttonClass('secondary')}>Sync over Bluetooth</Link>
          </div>
          <p className="text-sm text-muted">
            Chrome or Edge, on Android or a computer. Bluetooth is off on the tracker until you turn it on.{' '}
            <Link href="/guide/bluetooth" className="tt-link">How</Link>.
          </p>
        </section>
      </Page>
    </main>
  )
}
