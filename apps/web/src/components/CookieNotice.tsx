'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'tt_cookie_acked'

// One-line dismissable banner. The only cookies are the two sign-in ones
// (tt_id, tt_refresh). Page views are counted with a per-tab random id in
// sessionStorage (not a cookie, not linked to an account) -- say so plainly
// rather than deny counting anything. See the privacy page.
export default function CookieNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true)
    } catch {
      // localStorage may be blocked (private mode, etc.) — fail silent
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setShow(false)
  }

  if (!show) return null

  // bottom-16 stacks it above the floating REPORT AN ISSUE button (bottom-4,
  // z-[1100]), which otherwise covers the OK button; z clears Leaflet's panes.
  return (
    <div className="fixed bottom-16 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-[1100] border border-border bg-bg shadow-lg p-4 text-xs text-fg flex flex-col gap-3">
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
