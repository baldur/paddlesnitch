'use client'
import Link from 'next/link'

// Shared signed-in/out account nav. Presentational + config-driven: the host app
// fetches the user and passes it in, along with the (app-specific) hrefs and a
// sign-out callback — so this has NO hardcoded /att vs /analyse routing. Replaces
// att's AuthNav.
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
    return <Link href={signInHref} className="text-muted hover:text-fg tracking-widest transition-colors">SIGN IN</Link>
  }

  return (
    <>
      <Link href={profileHref} className="text-fg hover:text-primary transition-colors" title="My public profile">{user.displayName}</Link>
      <Link href={accountHref} className="text-muted hover:text-fg tracking-widest transition-colors" title="Account settings">ACCOUNT</Link>
      <button onClick={onSignOut} className="text-muted hover:text-red tracking-widest transition-colors">SIGN OUT</button>
    </>
  )
}
