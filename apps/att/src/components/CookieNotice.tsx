'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'tt_cookie_acked'

// One-line dismissable banner. We only set essential auth cookies (tt_id,
// tt_refresh), no analytics or trackers, so there is nothing optional to
// consent to — hence no Accept/Reject buttons. We still show this for
// transparency and PECR compliance.
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

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-50 border border-border bg-bg shadow-lg p-4 text-xs text-fg flex flex-col gap-3">
      <p>
        We use essential cookies for sign-in only. No analytics, no trackers.{' '}
        <Link href="/att/privacy" className="tt-link">Privacy policy</Link>.
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
