'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@paddlesnitch/ui/Button'

// Remove (unlink) a tracker from the account, from its own page. Asks once
// before doing it. The tracker is signed out and stops uploading until it is
// added again; the recordings it already uploaded stay the user's. A phone
// (C3) works the same way: the app adds it again when its owner next records.
export default function RemoveTrackerButton({ deviceId, phone = false }: { deviceId: string; phone?: boolean }) {
  const thing = phone ? 'phone' : 'tracker'
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
      setErr(`Couldn’t remove the ${thing}. Please try again.`)
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={buttonClass('danger', 'md', 'self-start')}>
        Remove {thing}
      </button>
    )
  }
  return (
    <div className="rounded-control border border-red/50 bg-red/5 p-4 flex flex-col gap-3">
      <p className="text-base text-fg">
        {phone
          ? 'Remove this phone? It stops uploading until you record on it with the app again. Its recordings stay yours.'
          : 'Remove this tracker? It stops uploading until you add it again. Its recordings stay yours.'}
      </p>
      {err && <p role="alert" className="text-sm text-red">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={remove} disabled={busy} className={buttonClass('danger', 'md', 'bg-red/10')}>
          {busy ? 'Removing…' : 'Remove'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClass('secondary')}>
          Cancel
        </button>
      </div>
    </div>
  )
}
