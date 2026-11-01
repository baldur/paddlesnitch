'use client'
import { useState, type ReactNode } from 'react'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cardClass } from '@paddlesnitch/ui/Card'

// Account → Strava: who is connected, and Disconnect, asked about first (#712).
// An account made with Sign in with Strava is also told it can't sign in
// afterwards, in the Android app's words.

type Props = {
  /** The badge and athlete name. */
  children: ReactNode
  /** False hides Disconnect (Strava switched off, and Strava is this account's only way in). */
  canDisconnect: boolean
  /** The account was made with Sign in with Strava (placeholder email, no password). */
  stravaOnly: boolean
  disconnecting: boolean
  onDisconnect: () => void
}

export default function StravaConnection({ children, canDisconnect, stravaOnly, disconnecting, onDisconnect }: Props) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className={`${cardClass} px-4 py-2 flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">{children}</div>
        {canDisconnect && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} disabled={disconnecting} className={buttonClass('quiet')}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>
      {canDisconnect && confirming && (
        <div className="flex flex-col gap-2 pb-2">
          <p className="text-sm text-fg">
            Disconnect Strava? New paddles stop coming in from Strava, and you can’t sign in with it. Paddles already here stay.
          </p>
          {/* Strava is this account's only way to sign in. */}
          {stravaOnly && (
            <p className="text-sm text-red">
              You sign in with Strava. Once it’s disconnected, you can’t sign in to this account until you connect it again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setConfirming(false); onDisconnect() }} className={buttonClass('danger')}>Disconnect</button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass('quiet')}>Keep</button>
          </div>
        </div>
      )}
    </div>
  )
}
