'use client'
import { useEffect, useState } from 'react'

// Add a paddlesnitch tracker to the signed-in account with the 6-character
// code the tracker shows on its screen. Lives on /devices (it used to be a
// section of the account page). Talks to /api/account/devices/link
// (docs/features/device-uplink.md).

const LINK_ERR: Record<string, string> = {
  unknown_code: 'We don’t recognise that code. Check the tracker’s screen and try again.',
  claim_expired: 'That code has expired. Get a new one on the tracker.',
  already_linked: 'That code has already been used.',
  owned_elsewhere: 'This tracker is on someone else’s account. They need to remove it on their Devices page first.',
  rate_limited: 'Too many tries. Wait a few minutes, then use the code on the tracker’s screen.',
}

export default function AddTrackerForm({ onAdded }: { onAdded?: () => void }) {
  // Prefilled from ?code= when the user arrived by scanning the QR on the
  // tracker (via /l/<code>), so the only remaining action is to confirm.
  //
  // Set AFTER mount, not in a lazy useState initialiser: this component is
  // server-rendered, where there is no window, so the initialiser gave '' on the
  // server and the code on the client, and React reported a hydration mismatch
  // on every QR arrival. Nothing reads `code` until the user presses ADD, so
  // filling it one tick later races with nothing.
  const [code, setCode] = useState('')
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('code')?.toUpperCase()
    if (fromUrl) setCode(fromUrl)
  }, [])
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (busy || code.trim().length < 6) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/account/devices/link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimCode: code.trim().toUpperCase(), name: name.trim() || undefined }),
      })
      if (r.ok) {
        setCode(''); setName('')
        setMsg({ tone: 'ok', text: 'Tracker added. It finishes setting up the next time it syncs.' })
        onAdded?.()
      } else {
        const err = (await r.json().catch(() => ({})))?.error
        setMsg({ tone: 'err', text: LINK_ERR[err] ?? 'Couldn’t add the tracker. Please try again.' })
      }
    } catch { setMsg({ tone: 'err', text: 'Couldn’t add the tracker. Please try again.' }) }
    finally { setBusy(false) }
  }

  return (
    <section id="add">
      <h2 className="text-xs text-muted tracking-[0.2em] uppercase mb-3">Add a tracker</h2>
      <p className="text-sm text-muted mb-4 leading-relaxed">
        Enter the 6-character code shown on the tracker’s screen, or scan its QR code.
      </p>

      <form onSubmit={add} className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="CODE e.g. K7P2QM" maxLength={6} autoCapitalize="characters" autoCorrect="off"
          aria-label="Code"
          className="bg-surface border border-border px-3 py-2 text-fg text-sm tracking-[0.3em] w-40 focus:outline-none focus:border-primary"
        />
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" maxLength={64}
          aria-label="Name"
          className="bg-surface border border-border px-3 py-2 text-fg text-sm flex-1 min-w-[8rem] focus:outline-none focus:border-primary"
        />
        <button type="submit" disabled={busy || code.trim().length < 6}
          className="px-4 py-2 bg-primary text-white text-xs tracking-widest hover:opacity-90 disabled:opacity-50 transition-opacity">
          ADD
        </button>
      </form>

      {msg && (
        <div role={msg.tone === 'err' ? 'alert' : 'status'} className={`border px-3 py-2 text-xs ${msg.tone === 'ok' ? 'border-green bg-green/10 text-green' : 'border-red bg-red/10 text-red'}`}>
          {msg.text}
        </div>
      )}
    </section>
  )
}
