'use client'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'

// Analyse's thin adapter around the shared AccountNav: fetches the signed-in
// user from /analyse/api/me and points profile/account/sign-in at the shared att
// pages (one platform, one account). Sign-out uses the shared auth cookie.
export default function AppAccountNav() {
  const [user, setUser] = useState<NavUser | null | undefined>(undefined)

  useEffect(() => {
    fetch('/analyse/api/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null))
  }, [])

  const onSignOut = async () => {
    try { await fetch('/att/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
    setUser(null)
    // Full nav (not router.push): /att is outside this app's '/analyse' basePath,
    // which router.push would prepend → /analyse/att.
    window.location.href = '/att'
  }

  return (
    <AccountNav
      user={user}
      profileHref={user ? `/att/u/${user.id}` : '/att'}
      accountHref="/att/account"
      signInHref="/att/auth?next=/analyse"
      onSignOut={onSignOut}
    />
  )
}
