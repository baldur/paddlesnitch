'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { capture, startAnalytics } from '@/lib/analytics'

// Mounts once (in the root layout). Starts the client capture pump (flush timer
// + unload listeners) and records a `pageview` on every route change. All the
// buffering/flushing lives in @/lib/analytics — capture() is safe to call from
// anywhere in client code to record other allowlisted events.
export default function Analytics() {
  const pathname = usePathname()

  useEffect(() => { startAnalytics() }, [])

  useEffect(() => {
    if (pathname) capture('pageview', { path: pathname })
  }, [pathname])

  return null
}
