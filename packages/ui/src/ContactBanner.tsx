'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

// Shared dismissible top banner, used by both apps for the Strava-only
// "add a contact email" prompt (replaces att's StravaContactBanner). The host
// app decides WHETHER to show it (it passes `shouldShow`, an async predicate,
// e.g. signed in + synthetic Strava email + no contact email saved) and supplies
// the CTA href + message. Dismissal is a per-browser cookie. Theme-aware.
export default function ContactBanner({
  shouldShow,
  href,
  cta = 'Add a contact email →',
  message = 'You signed in with Strava, which doesn’t share an email — so we can’t reach you about your account. Add one so you don’t miss anything.',
  dismissKey = 'ps_contact_banner_dismissed',
}: {
  shouldShow: () => Promise<boolean>
  href: string
  cta?: string
  message?: string
  dismissKey?: string
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (document.cookie.split('; ').some(c => c.startsWith(`${dismissKey}=1`))) return
    let cancelled = false
    shouldShow().then(ok => { if (!cancelled && ok) setShow(true) }).catch(() => {})
    return () => { cancelled = true }
  }, [shouldShow, dismissKey])

  if (!show) return null

  const dismiss = () => {
    document.cookie = `${dismissKey}=1; max-age=${60 * 60 * 24 * 180}; path=/; samesite=lax`
    setShow(false)
  }

  return (
    <div className="border-b border-border bg-surface px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted min-w-0">{message}</span>
      <span className="flex items-center gap-3 shrink-0">
        <Link href={href} className="text-primary hover:underline tracking-widest">{cta}</Link>
        <button type="button" onClick={dismiss} className="text-muted hover:text-fg" aria-label="Dismiss">✕</button>
      </span>
    </div>
  )
}
