'use client'
import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'tt_cookie_acked'

// Read once after hydration; OK in this tab is tracked in state below.
const subscribe = () => () => {}

function notAcked() {
  try {
    return !localStorage.getItem(STORAGE_KEY)
  } catch {
    // localStorage may be blocked (private mode, etc.) — fail silent
    return false
  }
}

// One-line dismissable banner. The only cookies are the two sign-in ones
// (tt_id, tt_refresh). Page views are counted with a per-tab random id in
// sessionStorage (not a cookie, not linked to an account) -- say so plainly
// rather than deny counting anything. See the privacy page.
export default function CookieNotice() {
  // Hidden on the server and during hydration; read storage after that.
  const unacked = useSyncExternalStore(subscribe, notAcked, () => false)
  const [dismissed, setDismissed] = useState(false)
  const show = unacked && !dismissed

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setDismissed(true)
  }

  if (!show) return null

  // On desktop, bottom-16 stacks it above the floating REPORT AN ISSUE button
  // (bottom-4, z-[1100]), which otherwise covers the OK button. Phones don't
  // show that button, so the notice sits at the bottom. z clears Leaflet's panes.
  return (
    <div className="fixed bottom-4 sm:bottom-16 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-[1100] border border-border bg-bg shadow-lg p-4 text-xs text-fg flex flex-col gap-3">
      <p>
        We use cookies only to keep you signed in. We count page views without cookies and
        without linking them to you. No ads, no third-party trackers.{' '}
        <Link href="/privacy" className="tt-link">Privacy policy</Link>.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="self-end px-4 py-1.5 bg-primary text-white tracking-widest hover:bg-primary transition-colors"
      >
        OK
      </button>
    </div>
  )
}
