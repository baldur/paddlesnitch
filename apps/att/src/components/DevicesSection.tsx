'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

// Account settings → Devices. Links a paddlesnitch hardware tracker to the
// signed-in account by the short code shown on the device's screen, and lists /
// revokes linked devices. Talks only to the platform-level /api/account/devices*
// endpoints (docs/features/device-uplink.md).
type Device = { deviceId: string; name: string; model: string; firmware?: string; lastSeenAt?: string; linkedAt?: string }

const fmtWhen = (iso?: string) => {
  if (!iso) return 'never'
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso.slice(0, 10) }
}

const LINK_ERR: Record<string, string> = {
  unknown_code: "That code isn't recognised — check the device screen and try again.",
  claim_expired: 'That code has expired — generate a fresh one on the device.',
  already_linked: 'That code has already been used.',
}

export default function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | undefined>(undefined)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch('/api/account/devices')
      .then(r => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices: Device[] }) => setDevices(d.devices ?? []))
      .catch(() => setDevices([]))
  }
  useEffect(load, [])

  async function linkDevice(e: React.FormEvent) {
    e.preventDefault()
    if (busy || code.trim().length < 6) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/account/devices/link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimCode: code.trim().toUpperCase(), name: name.trim() || undefined }),
      })
      if (r.ok) { setCode(''); setName(''); setMsg({ tone: 'ok', text: 'Tracker linked ✓ — it will finish pairing on its next sync.' }); load() }
      else {
        const err = (await r.json().catch(() => ({})))?.error
        setMsg({ tone: 'err', text: LINK_ERR[err] ?? 'Could not link the device.' })
      }
    } catch { setMsg({ tone: 'err', text: 'Could not link the device.' }) }
    finally { setBusy(false) }
  }

  async function revoke(deviceId: string) {
    setBusy(true); setMsg(null)
    try {
      await fetch('/api/account/devices', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId }) })
      load()
    } catch { setMsg({ tone: 'err', text: 'Could not revoke the device.' }) }
    finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">Devices</h2>
      <p className="text-sm text-muted mb-4 leading-relaxed">
        Link a paddlesnitch tracker so it uploads sessions on its own. On the device screen you&apos;ll
        see a 6-character code — enter it here while signed in. Uploaded sessions appear under{' '}
        <span className="text-fg">MY TRACKER</span> in Analyse, and you can inspect the raw data on the{' '}
        <Link href="/profile/me/devices" className="text-primary">device data</Link> page.
      </p>

      <form onSubmit={linkDevice} className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="CODE e.g. K7P2QM" maxLength={6} autoCapitalize="characters" autoCorrect="off"
          className="bg-surface border border-border px-3 py-2 text-fg text-sm tracking-[0.3em] w-40 focus:outline-none focus:border-primary"
        />
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" maxLength={64}
          className="bg-surface border border-border px-3 py-2 text-fg text-sm flex-1 min-w-[8rem] focus:outline-none focus:border-primary"
        />
        <button type="submit" disabled={busy || code.trim().length < 6}
          className="px-4 py-2 bg-primary text-white text-xs tracking-widest hover:opacity-90 disabled:opacity-50 transition-opacity">
          LINK
        </button>
      </form>

      {msg && (
        <div className={`mb-3 border px-3 py-2 text-xs ${msg.tone === 'ok' ? 'border-green bg-green/10 text-green' : 'border-red bg-red/10 text-red'}`}>
          {msg.text}
        </div>
      )}

      {devices === undefined ? (
        <p className="text-xs text-muted">Checking…</p>
      ) : devices.length === 0 ? (
        <p className="text-xs text-muted">No trackers linked yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map(d => (
            <li key={d.deviceId} className="flex items-center justify-between gap-4 border border-border px-4 py-3">
              <div className="text-sm min-w-0">
                <span className="text-fg truncate">{d.name}</span>
                <span className="block text-xs text-muted tabular">{d.model} · {d.deviceId} · last seen {fmtWhen(d.lastSeenAt)}</span>
              </div>
              <button type="button" onClick={() => revoke(d.deviceId)} disabled={busy}
                className="px-4 py-2 border border-muted text-muted text-xs tracking-widest hover:bg-surface-2 hover:text-red disabled:opacity-50 transition-colors shrink-0">
                REVOKE
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
