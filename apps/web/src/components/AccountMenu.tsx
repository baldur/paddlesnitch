'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'
import { useSessionUser } from '@/components/SessionUser'
import { isSyntheticStravaEmail } from '@/lib/strava-account'

// The account menu in the header on every page: the shared AccountNav, wired to
// the signed-in user and the platform routes. (There used to be two of these,
// one per former app, with different sign-in and sign-out behaviour.)
// The header renders this twice (the dropdown from sm up, the phone's "You"
// tab), so the two share one request for each thing they ask the server.
let shared: { me?: Promise<NavUser | null>; waiting?: Promise<number> } = {}
const once = <K extends keyof typeof shared>(k: K, load: () => NonNullable<(typeof shared)[K]>) =>
  (shared[k] ??= load()) as NonNullable<(typeof shared)[K]>
// A new page view asks again.
export function resetAccountMenuCache() { shared = {} }

// An account made with Strava (removed 2026-11) can't sign back in until we
// move it to a real email, so signing out asks first. Same words as the apps.
const SIGN_OUT_CONFIRM = {
  text: 'You made this account with Strava, so you can’t sign back in until we move it to your email.',
  emailHref: 'mailto:privacy@paddlesnitch.com?subject=Move%20my%20account%20to%20my%20email',
}

export default function AccountMenu({ variant = 'menu' }: { variant?: 'menu' | 'tab' } = {}) {
  const pathname = usePathname() ?? '/'
  // From the server with the page (#411); asked for only when it couldn't tell.
  const fromServer = useSessionUser()
  const [user, setUser] = useState<NavUser | null | undefined>(fromServer)
  // Buddy requests waiting for an answer: a badge on the menu.
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    const waitingFor = (u: NavUser | null) => {
      if (!u) return
      once('waiting', () => fetch('/api/trpc/buddies.pendingCount')
        .then(r => (r.ok ? r.json() : null))
        .then(b => Number(b?.result?.data) || 0)
        .catch(() => 0))
        .then(setWaiting)
    }
    if (fromServer !== undefined) { waitingFor(fromServer); return }
    once('me', () => fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      // Only what the header needs: never keep the email.
      .then((u: (NavUser & { email?: string }) | null) => u && {
        id: u.id, displayName: u.displayName, ...(isSyntheticStravaEmail(u.email) ? { placeholderEmail: true as const } : {}),
      })
      .catch(() => null))
      .then((u: NavUser | null) => { setUser(u); waitingFor(u) })
  }, [fromServer])
  // Forget the shared answers when the page changes (or after sign-out).
  useEffect(() => () => resetAccountMenuCache(), [pathname])

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
      signOutConfirm={user?.placeholderEmail ? SIGN_OUT_CONFIRM : undefined}
      variant={variant}
    />
  )
}
