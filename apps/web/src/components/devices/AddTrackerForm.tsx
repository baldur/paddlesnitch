'use client'
import { useId, useState, useSyncExternalStore } from 'react'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cardClass } from '@paddlesnitch/ui/Card'

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

const noSubscribe = () => () => {}
const codeFromUrl = () => new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? ''

export default function AddTrackerForm({ onAdded }: { onAdded?: () => void }) {
  // Prefilled from ?code= when the user arrived by scanning the QR on the
  // tracker (via /l/<code>), so the only remaining action is to confirm.
  //
  // Read AFTER hydration, not in a lazy useState initialiser: this component is
  // server-rendered, where there is no window, so the initialiser gave '' on the
  // server and the code on the client, and React reported a hydration mismatch
  // on every QR arrival. useSyncExternalStore renders '' on the server and while
  // hydrating, then the URL's code. Once the user types, their text wins.
  const fromUrl = useSyncExternalStore(noSubscribe, codeFromUrl, () => '')
  const [typed, setCode] = useState<string | null>(null)
  const code = typed ?? fromUrl
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

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
    <section id="add" aria-labelledby={`${id}-h`} className={`${cardClass} p-4 sm:p-5 flex flex-col gap-4`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-h`} className="text-lg font-semibold text-fg">Add a tracker</h2>
        <p className="text-sm text-muted">
          Enter the 6-character code on the tracker’s screen, or scan its QR code.
        </p>
      </div>

      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
        <Field label="Code" htmlFor={`${id}-code`}>
          <input
            id={`${id}-code`}
            value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="K7P2QM" maxLength={6} autoCapitalize="characters" autoCorrect="off" autoComplete="off"
            className={`${inputClass} tabular`}
          />
        </Field>
        <Field label="Name (optional)" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Club K1" maxLength={64}
            className={inputClass}
          />
        </Field>
        <button type="submit" disabled={busy || code.trim().length < 6} className={buttonClass('primary')}>
          {busy ? 'Adding…' : 'Add tracker'}
        </button>
      </form>

      {msg && (
        <p role={msg.tone === 'err' ? 'alert' : 'status'} className={`rounded-control border px-3 py-2 text-sm ${msg.tone === 'ok' ? 'border-green/50 bg-green/10 text-green' : 'border-red/50 bg-red/10 text-red'}`}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
