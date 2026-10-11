'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'
import { useSessionUser } from '@/components/SessionUser'

// The account menu in the header on every page: the shared AccountNav, wired to
// the signed-in user and the platform routes. (There used to be two of these,
// one per former app, with different sign-in and sign-out behaviour.)
export default function AccountMenu() {
  const pathname = usePathname() ?? '/'
  // From the server with the page (#411); asked for only when it couldn't tell.
  const fromServer = useSessionUser()
  const [user, setUser] = useState<NavUser | null | undefined>(fromServer)
  // Buddy requests waiting for an answer: a badge on the menu.
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    const waitingFor = (u: NavUser | null) => {
      if (!u) return
      fetch('/api/trpc/buddies.pendingCount')
        .then(r => (r.ok ? r.json() : null))
        .then(b => setWaiting(Number(b?.result?.data) || 0))
        .catch(() => {})
    }
    if (fromServer !== undefined) { waitingFor(fromServer); return }
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then((u: NavUser | null) => { setUser(u); waitingFor(u) })
      .catch(() => setUser(null))
  }, [fromServer])

  // A full load, not router.push: the page's header gets its user from the
  // server with the page, and a client-side navigation would keep the old one.
  const onSignOut = async () => {
    await fetch('/att/api/auth/logout', { method: 'POST' })
    setUser(null)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is the point
    window.location.assign('/')
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
