'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cardClass } from '@paddlesnitch/ui/Card'

// Account → Strava: who is connected, and Disconnect, asked about first (#712).
// What the confirm says about signing in afterwards follows the Strava sign-in
// callback: an account made with Sign in with Strava gets back in (and
// reconnected) by signing in with Strava; any other account would get a new,
// empty account that way, because the link to it is gone.

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
  const disconnectRef = useRef<HTMLButtonElement>(null)
  const closed = useRef(false)
  const questionId = useId()
  // Back on Disconnect after Keep, so keyboard and screen-reader users aren't left on the page body.
  useEffect(() => {
    if (!confirming && closed.current) disconnectRef.current?.focus()
  }, [confirming])
  const close = () => { closed.current = true; setConfirming(false) }

  return (
    <div className={`${cardClass} px-4 py-2 flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-4 min-h-11">
        <div className="flex items-center gap-2 min-w-0">{children}</div>
        {canDisconnect && !confirming && (
          <button ref={disconnectRef} type="button" onClick={() => setConfirming(true)} disabled={disconnecting} className={buttonClass('quiet')}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
      </div>
      {canDisconnect && confirming && (
        <div role="group" aria-labelledby={questionId} className="flex flex-col gap-2 pb-2">
          <p id={questionId} className="text-sm text-fg">
            Disconnect Strava? New paddles stop coming in from Strava. Paddles already here stay.
          </p>
          <p className="text-sm text-muted">
            {stravaOnly
              ? 'You sign in with Strava. To get back in later, use Sign in with Strava, which connects it again.'
              : 'Signing in with Strava would then start a new, empty account.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { close(); onDisconnect() }} className={buttonClass('danger')}>Disconnect</button>
            {/* The safe choice takes focus when the question opens. */}
            <button type="button" autoFocus onClick={close} className={buttonClass('quiet')}>Keep</button>
          </div>
        </div>
      )}
    </div>
  )
}
