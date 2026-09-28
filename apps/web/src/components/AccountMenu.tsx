'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'

// The account menu in the header on every page: the shared AccountNav, wired to
// the signed-in user and the platform routes. (There used to be two of these,
// one per former app, with different sign-in and sign-out behaviour.)
export default function AccountMenu() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const [user, setUser] = useState<NavUser | null | undefined>(undefined)

  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  const onSignOut = async () => {
    await fetch('/att/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.refresh()
    router.push('/')
  }

  return (
    <AccountNav
      user={user}
      paddlesHref="/paddles"
      devicesHref="/devices"
      profileHref="/profile/me"
      accountHref="/account"
      // Back to where you were after signing in.
      signInHref={pathname === '/' ? '/att/auth' : `/att/auth?next=${encodeURIComponent(pathname)}`}
      onSignOut={onSignOut}
    />
  )
}
