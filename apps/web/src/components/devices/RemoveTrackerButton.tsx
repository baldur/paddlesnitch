'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Remove (unlink) a tracker from the account, from its own page. Asks once
// before doing it. The tracker is signed out and stops uploading until it is
// added again; the recordings it already uploaded stay the user's.
export default function RemoveTrackerButton({ deviceId }: { deviceId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function remove() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/account/devices', {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId }),
      })
      if (!r.ok) throw new Error()
      router.push('/devices')
    } catch {
      setErr('Couldn’t remove the tracker. Please try again.')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="self-start px-4 py-2 border border-muted text-muted text-xs tracking-widest hover:bg-surface-2 hover:text-red transition-colors">
        REMOVE TRACKER
      </button>
    )
  }
  return (
    <div className="border border-red/60 bg-red/5 px-4 py-3 flex flex-col gap-3 text-sm">
      <p className="text-fg">
        Remove this tracker? It stops uploading until you add it again. Its recordings stay yours.
      </p>
      {err && <p role="alert" className="text-red text-xs">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={remove} disabled={busy}
          className="px-4 py-2 bg-red text-white text-xs tracking-widest hover:opacity-90 disabled:opacity-50 transition-opacity">
          {busy ? 'REMOVING…' : 'REMOVE'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy}
          className="px-4 py-2 border border-border text-muted text-xs tracking-widest hover:bg-surface-2 transition-colors">
          CANCEL
        </button>
      </div>
    </div>
  )
}
