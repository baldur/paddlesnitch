'use client'

// Shared signed-in/out account nav. Presentational + config-driven: the host app
// fetches the user and passes it in, along with the (app-specific) hrefs and a
// sign-out callback — so this has NO hardcoded /att vs /analyse routing. Replaces
// att's AuthNav.
//
// Uses plain <a>, not next/link: the profile/account/sign-in hrefs point at the
// att app (/att/…), which is a cross-app boundary from Analyse (basePath
// '/analyse' would otherwise prepend and produce /analyse/att/…). Full-nav is
// correct across the two apps.
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
  if (user === undefined) return null // loading — don't flash the wrong state

  if (!user) {
    return <a href={signInHref} className="text-muted hover:text-fg tracking-widest transition-colors">SIGN IN</a>
  }

  return (
    <>
      <a href={profileHref} className="text-fg hover:text-primary transition-colors" title="My public profile">{user.displayName}</a>
      <a href={accountHref} className="text-muted hover:text-fg tracking-widest transition-colors" title="Account settings">ACCOUNT</a>
      <button onClick={onSignOut} className="text-muted hover:text-red tracking-widest transition-colors">SIGN OUT</button>
    </>
  )
}
