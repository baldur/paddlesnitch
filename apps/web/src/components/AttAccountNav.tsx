'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'
import { useHasDevice } from '@/lib/use-has-device'

// att's adapter around the shared AccountNav: fetches the signed-in user and
// wires att's profile/account/sign-in routes + sign-out. Replaces AuthNav.
export default function AttAccountNav() {
  const router = useRouter()
  const [user, setUser] = useState<NavUser | null | undefined>(undefined)

  useEffect(() => {
    fetch('/att/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  const hasDevice = useHasDevice(!!user)

  const onSignOut = async () => {
    await fetch('/att/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.refresh()
    router.push('/')
  }

  return (
    <AccountNav
      user={user}
      paddlesHref="/paddles/library"
      devicesHref={hasDevice ? '/profile/me/devices' : undefined}
      profileHref={user ? "/profile/me" : "/att"}
      accountHref="/account"
      signInHref="/att/auth"
      onSignOut={onSignOut}
    />
  )
}
