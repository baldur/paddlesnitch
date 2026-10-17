'use client'
import { useEffect, useRef, useState } from 'react'

// Shared signed-in/out account nav. Presentational + config-driven: the host app
// fetches the user and passes it in, along with the (app-specific) hrefs and a
// sign-out callback — so this has NO hardcoded /att vs /paddles routing. Replaces
// att's AuthNav.
//
// Signed in, it's a single dropdown ("Name ▾") holding everything common to
// every page: Paddles, Buddies, Devices, Profile, Account, Report an issue,
// Sign out. On phones the same items open as a bottom sheet from the bottom
// bar's "You" tab (variant 'tab'). Signed out it's a plain "Sign in" link.
//
// Uses plain <a>, not next/link: the profile/account/sign-in hrefs point at the
// att app (/att/…, /profile/…), which is a cross-app boundary from Analyse
// (basePath '/paddles' would otherwise prepend and produce /paddles/att/…).
// Full-nav is correct across the two apps.

// The menu's "Report an issue" item opens the shared FeedbackWidget via this
// window event (same contract AppShell used for its old REPORT link).
const OPEN_FEEDBACK = 'paddlesnitch:open-feedback'

export type NavUser = { id: string; displayName: string }

// The person icon on the phone's "You" tab.
export function PersonIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  )
}

export default function AccountNav({
  user,
  paddlesHref,
  devicesHref,
  buddiesHref,
  buddiesWaiting = 0,
  profileHref,
  accountHref,
  signInHref,
  onSignOut,
  variant = 'menu',
}: {
  user: NavUser | null | undefined   // undefined = still loading
  paddlesHref?: string               // optional Paddles link
  devicesHref?: string               // optional Devices link
  buddiesHref?: string               // optional Buddies link
  buddiesWaiting?: number            // buddy requests waiting for an answer (a badge)
  profileHref: string
  accountHref: string
  signInHref: string
  onSignOut: () => void
  // 'menu': the header dropdown (from sm up). 'tab': the phone's bottom-bar
  // "You" tab, which opens the same items as a bottom sheet.
  variant?: 'menu' | 'tab'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const tab = variant === 'tab'
  const tabClass = 'flex flex-col items-center justify-center gap-0.5 min-h-14 w-full text-xs font-medium text-muted hover:text-fg'

  if (user === undefined) {
    // loading — don't flash the wrong state (but keep the tab's slot)
    return tab ? <span className={tabClass} aria-hidden><PersonIcon className="w-6 h-6 opacity-40" /></span> : null
  }

  if (!user) {
    return tab
      ? <a href={signInHref} className={tabClass}><PersonIcon className="w-6 h-6" />Sign in</a>
      : <a href={signInHref} className="text-sm font-medium text-fg hover:text-primary-text transition-colors">Sign in</a>
  }

  const item = `flex items-center justify-between gap-3 w-full text-left px-4 ${tab ? 'min-h-12 text-base' : 'min-h-10 text-sm'} transition-colors`
  const badge = buddiesWaiting > 0 && (
    <span className="w-2 h-2 rounded-full bg-primary-text" aria-label={`${buddiesWaiting} buddy request${buddiesWaiting === 1 ? '' : 's'} waiting`} />
  )

  const items = (
    <>
      {paddlesHref && <a role="menuitem" href={paddlesHref} className={`${item} text-fg hover:bg-surface-2`}>Paddles</a>}
      {buddiesHref && (
        <a role="menuitem" href={buddiesHref} className={`${item} text-fg hover:bg-surface-2`}>
          Buddies
          {buddiesWaiting > 0 && <span className="text-xs rounded-full bg-primary text-white px-2">{buddiesWaiting}</span>}
        </a>
      )}
      {devicesHref && <a role="menuitem" href={devicesHref} className={`${item} text-fg hover:bg-surface-2`}>Devices</a>}
      <a role="menuitem" href={profileHref} className={`${item} text-fg hover:bg-surface-2`}>Profile</a>
      <a role="menuitem" href={accountHref} className={`${item} text-fg hover:bg-surface-2`}>Account</a>
      <div className="my-1 border-t border-border" />
      <button
        role="menuitem"
        type="button"
        onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK)) }}
        className={`${item} text-muted hover:bg-surface-2 hover:text-fg`}
      >
        Report an issue
      </button>
      <button
        role="menuitem"
        type="button"
        onClick={() => { setOpen(false); onSignOut() }}
        className={`${item} text-muted hover:bg-surface-2 hover:text-red`}
      >
        Sign out
      </button>
    </>
  )

  if (tab) {
    return (
      <div ref={ref} className="w-full">
        <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} className={`${tabClass} ${open ? 'text-fg' : ''}`}>
          <span className="relative">
            <PersonIcon className="w-6 h-6" />
            {badge && <span className="absolute -top-0.5 -right-1">{badge}</span>}
          </span>
          You
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[1190] bg-black/50" aria-hidden onClick={() => setOpen(false)} />
            <div role="menu" aria-label="Your account" className="fixed inset-x-0 bottom-0 z-[1200] rounded-t-sheet border-t border-border-strong bg-surface pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] pt-2 flex flex-col">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong" aria-hidden />
              <p className="px-4 pb-2 text-sm text-muted truncate">Signed in as <span className="text-fg font-medium">{user.displayName}</span></p>
              {items}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 min-h-10 text-sm font-medium text-fg hover:text-primary-text transition-colors"
        title="Account menu"
      >
        <span className="truncate max-w-[10rem]">{user.displayName}</span>
        {badge}
        <svg aria-hidden viewBox="0 0 20 20" className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 min-w-[12rem] rounded-control border border-border-strong bg-surface shadow-lg z-[1200] flex flex-col py-1">
          {items}
        </div>
      )}
    </div>
  )
}
