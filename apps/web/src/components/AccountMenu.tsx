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
  // Buddy requests waiting for an answer: a badge on the menu.
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then((u: NavUser | null) => {
        setUser(u)
        if (u) {
          fetch('/api/trpc/buddies.pendingCount')
            .then(r => (r.ok ? r.json() : null))
            .then(b => setWaiting(Number(b?.result?.data) || 0))
            .catch(() => {})
        }
      })
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
      buddiesHref="/buddies"
      buddiesWaiting={waiting}
      profileHref="/profile/me"
      accountHref="/account"
      // Back to where you were after signing in.
      signInHref={pathname === '/' ? '/signin' : `/signin?next=${encodeURIComponent(pathname)}`}
      onSignOut={onSignOut}
    />
  )
}
