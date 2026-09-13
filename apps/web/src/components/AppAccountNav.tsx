'use client'
import AccountNav from '@paddlesnitch/ui/AccountNav'
import { trpc } from '@/lib/trpc'

// Analyse's thin adapter around the shared AccountNav: reads the signed-in user
// via the tRPC `me` procedure and points profile/account/sign-in at the shared
// att pages (one platform, one account). Sign-out uses the shared auth cookie.
export default function AppAccountNav() {
  const q = trpc.me.useQuery()
  const user = q.isPending ? undefined : (q.data?.user ?? null)

  const onSignOut = async () => {
    try { await fetch('/att/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
    // Full nav to the platform home (a server component that re-reads auth).
    window.location.href = '/'
  }

  return (
    <AccountNav
      user={user}
      paddlesHref="/paddles/library"
      profileHref={user ? "/profile/me" : "/att"}
      accountHref="/profile/me/settings"
      signInHref="/att/auth?next=/paddles"
      onSignOut={onSignOut}
    />
  )
}
