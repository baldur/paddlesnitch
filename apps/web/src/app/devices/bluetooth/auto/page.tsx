'use client'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cardClass } from '@paddlesnitch/ui/Card'
import { navigationCheck, runAutoChecks, type AutoBluetooth, type Check } from '@/lib/tracker-ble-auto'

// The auto-sync spike (#416): a test page, linked from nowhere, for the owner
// to run on an Android phone. Each answer decides part of quiet background
// sync; "Copy results" gives text to paste into the issue.

const noSubscribe = () => () => {}
const MARK = { pass: '✓', fail: '✗', skip: '–' } as const
// useSyncExternalStore needs the same object back while nothing changed.
let lastBack: { key: string; value: Check | null } = { key: 'null', value: null }
function backSnapshot() {
  const value = navigationCheck()
  const key = value ? `${value.state}` : 'null'
  if (key !== lastBack.key) lastBack = { key, value }
  return lastBack.value
}

export default function AutoSyncSpikePage() {
  // Read after hydration (no navigator on the server). The navigation check
  // reads module state from an earlier run on this page, also client-only.
  const bt = useSyncExternalStore(noSubscribe, () => (navigator as { bluetooth?: AutoBluetooth }).bluetooth ?? null, () => undefined)
  const back = useSyncExternalStore(noSubscribe, backSnapshot, () => null)
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const shown = back ? [...checks, back] : checks

  async function run() {
    setRunning(true); setChecks([]); setCopied(false)
    await runAutoChecks(bt ?? null, c => setChecks(cs => [...cs, c]))
    setRunning(false)
  }
  async function copy() {
    const text = [`Auto-sync spike (#416), ${new Date().toISOString()}`, navigator.userAgent, ...shown.map(c => `${MARK[c.state]} ${c.label}: ${c.detail}`)].join('\n')
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/devices/bluetooth" className="tt-nav-link text-sm">← Bluetooth</Link>} />
      <Page width="narrow">
        <PageHeader title="Auto-sync test" description="Can this phone reach your tracker without a tap? Pair the tracker on the Bluetooth page first, keep it on and nearby, then run the test." />
        {bt === null && <p className="text-base text-red">This browser has no Bluetooth. Use Chrome on Android.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass('primary')} onClick={run} disabled={running || !bt}>{running ? 'Testing…' : 'Run the test'}</button>
          {shown.length > 0 && <button type="button" className={buttonClass('secondary')} onClick={copy}>{copied ? 'Copied' : 'Copy results'}</button>}
        </div>
        {shown.length > 0 && (
          <ul className={`${cardClass} divide-y divide-border`} aria-live="polite">
            {shown.map(c => (
              <li key={c.id} className="px-4 py-3">
                <p className={`text-base font-medium ${c.state === 'pass' ? 'text-green' : c.state === 'fail' ? 'text-red' : 'text-muted'}`}>{MARK[c.state]} {c.label}</p>
                <p className="text-sm text-muted break-words">{c.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          Last check: after a test that connected, open <Link href="/paddles" className="tt-link">Paddles</Link> and come back here with the back button. A fourth line then says whether the connection survived.
        </p>
      </Page>
    </main>
  )
}
