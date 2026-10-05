'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import AppHeader from '@/components/AppHeader'
import {
  TRACKER_SERVICE, TRACKER_ABOUT, TRACKER_PAIRED, TRACKER_LINK, TRACKER_WIFI, WIFI_WAIT,
  parseAbout, readWhenPaired, ownership, browserBluetooth, parseLinkStatus, parseWifiState,
  wifiMessage, linkErrorMessage, setupErrorMessage, type TrackerAbout,
} from '@/lib/tracker-ble'

// Bluetooth test page (docs/features/tracker-bluetooth-sync.md, P4 + J1 step 3).
// Linked from nowhere yet: connect to a nearby tracker, read its details, pair
// it, add it to this account and give it WiFi details. Only bench-build
// trackers have Bluetooth so far.

type Found = {
  name: string
  about: TrackerAbout
  readPaired: () => Promise<string>
  read: (uuid: string) => Promise<string>
  write: (uuid: string, body: unknown) => Promise<void>
}
type Msg = { ok: boolean; text: string } | null

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
  // What the browser said, shown under a pairing failure (this is a test page).
  const [detail, setDetail] = useState('')
  const [disconnect, setDisconnect] = useState<(() => void) | null>(null)
  const [paired, setPaired] = useState(false)
  // The open connection, so leaving the page can drop it. A tab left connected
  // stops the tracker advertising, which hid it from a phone during testing.
  const drop = useRef<(() => void) | null>(null)
  useEffect(() => {
    const leave = () => drop.current?.()
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); leave() }
  }, [])
  const [pairing, setPairing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linkMsg, setLinkMsg] = useState<Msg>(null)
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [wifiBusy, setWifiBusy] = useState(false)
  const [wifiMsg, setWifiMsg] = useState<Msg>(null)

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
      const read = async (uuid: string) => new TextDecoder().decode(await (await svc.getCharacteristic(uuid)).readValue())
      const write = async (uuid: string, body: unknown) =>
        (await svc.getCharacteristic(uuid)).writeValueWithResponse(new TextEncoder().encode(JSON.stringify(body)))
      setFound({ name: device.name ?? 'Tracker', about, readPaired, read, write })
      drop.current = () => device.gatt?.disconnect()
      setDisconnect(() => () => { device.gatt?.disconnect(); drop.current = null; setFound(null); setDisconnect(null) })
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
    // Keeps trying while the phone or computer and the tracker finish
    // pairing: the first read is refused before the link is encrypted.
    setDetail('')
    const r = await readWhenPaired(found.readPaired)
    if (r.paired) setPaired(true)
    else {
      setError("Couldn't pair. Check the number on the tracker matches, hold its button within 25 seconds, then try again.")
      setDetail(r.lastError ?? '')
    }
    setPairing(false)
  }

  // Add the tracker to this account. The tracker makes a token and keeps it;
  // only its hash comes back, gets registered, and then the tracker commits.
  async function addToAccount() {
    if (!found) return
    setLinking(true); setLinkMsg(null)
    try {
      await found.write(TRACKER_LINK, { op: 'begin' })
      const st = parseLinkStatus(await found.read(TRACKER_LINK))
      if (!st || st.state !== 'pending' || !st.tokenHash) throw new Error('no hash')
      const res = await fetch('/api/account/devices/link-bluetooth', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: st.id, tokenHash: st.tokenHash, model: found.about.model, firmware: found.about.firmware }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string }
        setLinkMsg({ ok: false, text: linkErrorMessage(res.status, b.error) })
        return
      }
      await found.write(TRACKER_LINK, { op: 'commit', tokenHash: st.tokenHash })
      if (parseLinkStatus(await found.read(TRACKER_LINK))?.state !== 'committed') throw new Error('not committed')
      setMine(new Set([...mine, st.id]))
      setLinkMsg({ ok: true, text: 'Added to your account.' })
    } catch (e) {
      // Pressing again starts over with a fresh token, which replaces anything
      // half-done on both sides -- unless the phone's copy of the tracker is
      // out of date, which only forgetting the tracker fixes.
      const stale = (e as { name?: string }).name === 'NotFoundError'
      setLinkMsg({ ok: false, text: stale ? setupErrorMessage(e, found.name) : "Couldn't finish adding the tracker. Press ADD TO MY ACCOUNT again." })
    } finally {
      setLinking(false)
    }
  }

  // Send WiFi details; the tracker tries them and saves them only if they work.
  async function saveWifi(e: React.FormEvent) {
    e.preventDefault()
    if (!found || !ssid.trim()) return
    setWifiBusy(true); setWifiMsg(null)
    try {
      await found.write(TRACKER_WIFI, { ssid: ssid.trim(), pass: wifiPass })
      for (let i = 0; i < WIFI_WAIT.tries; i++) {
        if (WIFI_WAIT.delayMs) await new Promise(r => setTimeout(r, WIFI_WAIT.delayMs))
        const st = parseWifiState(await found.read(TRACKER_WIFI))
        if (st && st !== 'trying' && st !== 'idle') {
          setWifiMsg({ ok: st === 'joined', text: wifiMessage(st) })
          if (st === 'joined') setWifiPass('')
          return
        }
      }
      setWifiMsg({ ok: false, text: "Couldn't hear back from the tracker. Check its screen, then try again." })
    } catch (e) {
      setWifiMsg({ ok: false, text: setupErrorMessage(e, found.name) })
    } finally {
      setWifiBusy(false)
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
            Connect to a tracker nearby, pair it, add it to your account and give it your WiFi. Only test trackers have Bluetooth so far.
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
        {error && detail && <p className="text-xs text-muted">Technical details: {detail}</p>}

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
            {pairing && (
              <p className="text-sm text-fg" role="status">
                Check the number on the tracker matches the one on this screen, then hold the tracker&apos;s button.
              </p>
            )}
            {!paired && !pairing && (
              <p className="text-xs text-muted">
                Pairing shows the same 6-digit number here and on the tracker. Hold the tracker&apos;s button if they match.
              </p>
            )}
            {paired && (
              <div className="flex flex-col gap-4 border-t border-border pt-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs text-fg tracking-widest">ACCOUNT</h3>
                  {ownership(found.about, mine) === 'yours' ? (
                    <p className="text-sm text-muted">This tracker is on your account.</p>
                  ) : (
                    <div>
                      <button type="button" onClick={addToAccount} disabled={linking}
                        className="px-4 py-2 bg-primary text-white text-sm tracking-widest disabled:opacity-60">
                        {linking ? 'ADDING…' : 'ADD TO MY ACCOUNT'}
                      </button>
                    </div>
                  )}
                  {linkMsg && <p className={`text-sm ${linkMsg.ok ? 'text-green' : 'text-red'}`} role="status">{linkMsg.text}</p>}
                </div>

                <form onSubmit={saveWifi} className="flex flex-col gap-2" aria-label="WiFi">
                  <h3 className="text-xs text-fg tracking-widest">WIFI</h3>
                  <p className="text-xs text-muted">The tracker tries the network first and keeps it only if it can join.</p>
                  <label htmlFor="bt-wifi-ssid" className="text-xs text-muted uppercase tracking-widest">Network name</label>
                  <input id="bt-wifi-ssid" value={ssid} onChange={e => setSsid(e.target.value)} maxLength={32} autoComplete="off"
                    className="bg-bg border border-border px-3 py-2 text-sm text-fg" />
                  <label htmlFor="bt-wifi-pass" className="text-xs text-muted uppercase tracking-widest">Password</label>
                  <input id="bt-wifi-pass" type="password" value={wifiPass} onChange={e => setWifiPass(e.target.value)} maxLength={64}
                    autoComplete="off" className="bg-bg border border-border px-3 py-2 text-sm text-fg" />
                  <div>
                    <button type="submit" disabled={wifiBusy || !ssid.trim()}
                      className="px-4 py-2 bg-primary text-white text-sm tracking-widest disabled:opacity-60">
                      {wifiBusy ? 'SAVING…' : 'SAVE WIFI'}
                    </button>
                  </div>
                  {wifiBusy && <p className="text-sm text-fg" role="status">The tracker is trying the network. This takes up to 30 seconds.</p>}
                  {wifiMsg && <p className={`text-sm ${wifiMsg.ok ? 'text-green' : 'text-red'}`} role="status">{wifiMsg.text}</p>}
                </form>
              </div>
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
