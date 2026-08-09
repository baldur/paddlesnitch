'use client'
import { useEffect, useRef, useState } from 'react'

// Shared signed-in/out account nav. Presentational + config-driven: the host app
// fetches the user and passes it in, along with the (app-specific) hrefs and a
// sign-out callback — so this has NO hardcoded /att vs /analyse routing. Replaces
// att's AuthNav.
//
// Signed in, it's a single dropdown ("Name ▾") holding everything common to
// every page: My profile, Settings, Report an issue, Sign out. This keeps the
// TRIALS/ANALYSE tabs + section-specific nav uncluttered in the header. Signed
// out it's a plain SIGN IN link (anonymous users still get the floating
// FeedbackWidget button for reporting).
//
// Uses plain <a>, not next/link: the profile/account/sign-in hrefs point at the
// att app (/att/…, /profile/…), which is a cross-app boundary from Analyse
// (basePath '/analyse' would otherwise prepend and produce /analyse/att/…).
// Full-nav is correct across the two apps.

// The menu's "Report an issue" item opens the shared FeedbackWidget via this
// window event (same contract AppShell used for its old REPORT link).
const OPEN_FEEDBACK = 'paddlesnitch:open-feedback'

export type NavUser = { id: string; displayName: string }

export default function AccountNav({
  user,
  profileHref,
  accountHref,
  signInHref,
  onSignOut,
}: {
  user: NavUser | null | undefined   // undefined = still loading
  profileHref: string
  accountHref: string
  signInHref: string
  onSignOut: () => void
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

  if (user === undefined) return null // loading — don't flash the wrong state

  if (!user) {
    return <a href={signInHref} className="text-muted hover:text-fg tracking-widest transition-colors">SIGN IN</a>
  }

  const item = 'block w-full text-left px-4 py-2 text-xs tracking-widest transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 text-fg hover:text-primary transition-colors"
        title="Account menu"
      >
        <span className="truncate max-w-[10rem]">{user.displayName}</span>
        <span className={`text-muted text-[0.65em] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">▼</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 min-w-[10rem] border border-border bg-surface shadow-md z-[1200] flex flex-col py-1">
          <a role="menuitem" href={profileHref} className={`${item} text-fg hover:bg-surface-2`}>MY PROFILE</a>
          <a role="menuitem" href={accountHref} className={`${item} text-muted hover:bg-surface-2 hover:text-fg`}>SETTINGS</a>
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK)) }}
            className={`${item} text-muted hover:bg-surface-2 hover:text-fg`}
          >
            REPORT AN ISSUE
          </button>
          <div className="my-1 border-t border-border" />
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); onSignOut() }}
            className={`${item} text-muted hover:bg-surface-2 hover:text-red`}
          >
            SIGN OUT
          </button>
        </div>
      )}
    </div>
  )
}
