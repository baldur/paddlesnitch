'use client'
import { createContext, useContext, type ReactNode } from 'react'
import type { NavUser } from '@paddlesnitch/ui/AccountNav'

// Who is signed in, from the server with the page (#411), so the header shows
// the account on first paint instead of fetching it after load.
// null = signed out; undefined = the server couldn't tell (the header asks).
//
// The root layout isn't re-rendered on a client-side navigation, so signing in
// or out loads the next page in full (window.location) rather than router.push.
const SessionUserContext = createContext<NavUser | null | undefined>(undefined)

export function SessionUserProvider({ user, children }: { user: NavUser | null | undefined; children: ReactNode }) {
  return <SessionUserContext.Provider value={user}>{children}</SessionUserContext.Provider>
}

export const useSessionUser = () => useContext(SessionUserContext)
