'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { capture, startAnalytics } from './analytics'

// Shared analytics mount — dropped once into each app's root layout. Starts the
// capture pump (flush timer + unload listeners) and records a `pageview` on every
// route change. Uses window.location.pathname (not usePathname) for the captured
// value so it's the TRUE full path in both apps — under Analyse's basePath
// '/analyse', usePathname() omits the prefix, which would collide with att paths;
// the full path keeps `/analyse/library` distinct from att's `/library`.
// usePathname is only the change trigger.
export default function Analytics() {
  const pathname = usePathname()

  useEffect(() => { startAnalytics() }, [])

  useEffect(() => {
    if (pathname && typeof window !== 'undefined') {
      capture('pageview', { path: window.location.pathname })
    }
  }, [pathname])

  return null
}
