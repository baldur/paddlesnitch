'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import { TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, parseAbout, isPairedReply, ownership, browserBluetooth, type TrackerAbout } from '@/lib/tracker-ble'

// Bluetooth test page (docs/features/tracker-bluetooth-sync.md, P4 step 1).
// Linked from nowhere yet: it connects to a nearby tracker and reads its
// details, nothing more. Only bench-build trackers have Bluetooth so far.

type Found = { name: string; about: TrackerAbout; readPaired: () => Promise<string> }

const OWNER_TEXT = {
  yours: 'On your account',
  elsewhere: 'Added to another account',
  unlinked: 'Not added to an account yet',
} as const

export default function BluetoothTestPage() {
  // Read after mount: the server render has no navigator, and the first client
  // render must match it.
  const [supported, setSupported] = useState<boolean | undefined>(undefined)
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [error, setError] = useState('')
  const [disconnect, setDisconnect] = useState<(() => void) | null>(null)
  const [paired, setPaired] = useState(false)
  const [pairing, setPairing] = useState(false)

  useEffect(() => {
    setSupported(browserBluetooth() !== null)
    fetch('/api/account/devices')
      .then(r => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices?: { deviceId: string }[] }) => setMine(new Set((d.devices ?? []).map(x => x.deviceId))))
      .catch(() => {})
  }, [])

  async function connect() {
    const bt = browserBluetooth()
    if (!bt) return
    setBusy(true); setError(''); setFound(null); setPaired(false)
    try {
      // The browser shows its own list, filtered to paddlesnitch trackers.
      const device = await bt.requestDevice({ filters: [{ services: [TRACKER_SERVICE] }] })
      if (!device.gatt) throw new Error('no gatt')
      const server = await device.gatt.connect()
      const svc = await server.getPrimaryService(TRACKER_SERVICE)
      const value = await (await svc.getCharacteristic(TRACKER_ABOUT)).readValue()
      const about = parseAbout(new TextDecoder().decode(value))
      if (!about) {
        device.gatt.disconnect()
        setError("Couldn't read this tracker. Its firmware may be too old for Bluetooth.")
        return
      }
      // Reading this item is refused until the connection is paired, and the
      // refusal is what makes the browser or phone start pairing.
      const readPaired = async () =>
        new TextDecoder().decode(await (await svc.getCharacteristic(TRACKER_PAIRED)).readValue())
      setFound({ name: device.name ?? 'Tracker', about, readPaired })
      setDisconnect(() => () => { device.gatt?.disconnect(); setFound(null); setDisconnect(null) })
    } catch (e) {
      // Closing the browser's list without choosing is not an error.
      if ((e as { name?: string }).name === 'NotFoundError') return
      setError("Couldn't connect to the tracker. Make sure it's switched on and close by, then try again.")
    } finally {
      setBusy(false)
    }
  }

  async function pair() {
    if (!found) return
    setPairing(true); setError('')
    try {
      if (!isPairedReply(await found.readPaired())) throw new Error('unexpected reply')
      setPaired(true)
    } catch {
      setError("Couldn't pair. Check the number on the tracker matches, hold its button within 25 seconds, then try again.")
    } finally {
      setPairing(false)
    }
  }

  return (
    <main className="flex-1 flex flex-col">
      <AppHeader
        breadcrumb={
          <>
            <Link href="/devices" className="tt-nav-link text-sm">← DEVICES</Link>
            <span className="text-muted">/</span>
            <span className="text-fg text-sm">BLUETOOTH</span>
          </>
        }
      />
      <div className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-bold text-fg tracking-widest">BLUETOOTH (TEST)</h1>
          <p className="text-sm text-muted mt-1">
            Connect to a tracker nearby and read its details. Only test trackers have Bluetooth so far.
          </p>
        </div>

        {supported === false && (
          <p className="text-sm text-fg border border-border bg-surface px-4 py-3">
            This browser can&apos;t use Bluetooth. Open this page in Chrome or Edge, on a computer or an Android phone.
          </p>
        )}

        {supported && !found && (
          <div>
            <button type="button" onClick={connect} disabled={busy}
              className="px-4 py-2 bg-primary text-white text-sm tracking-widest disabled:opacity-60">
              {busy ? 'CONNECTING…' : 'CONNECT'}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red" role="alert">{error}</p>}

        {found && (
          <section className="border border-border bg-surface px-4 py-4 flex flex-col gap-3" aria-label="Tracker">
            <h2 className="text-sm text-fg tracking-widest">{found.name}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">ID</dt><dd className="text-fg tabular">{found.about.id}</dd>
              <dt className="text-muted">Firmware</dt><dd className="text-fg tabular">{found.about.firmware}</dd>
              <dt className="text-muted">Recordings</dt>
              <dd className="text-fg">
                {found.about.waiting === null ? 'Still counting' : `${found.about.waiting} waiting to upload`}
              </dd>
              <dt className="text-muted">Account</dt><dd className="text-fg">{OWNER_TEXT[ownership(found.about, mine)]}</dd>
              <dt className="text-muted">Pairing</dt>
              <dd className={paired ? 'text-green' : 'text-fg'}>{paired ? 'Paired' : 'Not paired'}</dd>
            </dl>
            {!paired && (
              <p className="text-xs text-muted">
                Pairing shows the same 6-digit number here and on the tracker. Hold the tracker&apos;s button if they match.
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              {!paired && (
                <button type="button" onClick={pair} disabled={pairing}
                  className="px-4 py-2 bg-primary text-white text-sm tracking-widest disabled:opacity-60">
                  {pairing ? 'PAIRING…' : 'PAIR'}
                </button>
              )}
              <button type="button" onClick={() => disconnect?.()}
                className="px-4 py-2 border border-border text-sm tracking-widest text-fg">
                DISCONNECT
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
