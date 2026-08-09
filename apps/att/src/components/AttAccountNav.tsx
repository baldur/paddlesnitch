'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AccountNav, { type NavUser } from '@paddlesnitch/ui/AccountNav'

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

  const onSignOut = async () => {
    await fetch('/att/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.refresh()
    router.push('/att')
  }

  return (
    <AccountNav
      user={user}
      profileHref={user ? `/att/u/${user.id}` : '/att'}
      accountHref="/att/account"
      signInHref="/att/auth"
      onSignOut={onSignOut}
    />
  )
}
