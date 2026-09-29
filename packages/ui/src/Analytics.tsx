'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { capture, startAnalytics } from './analytics'
import { campaignFrom, publicPath } from './metrics-events'

// Shared analytics mount — dropped once into each app's root layout. Starts the
// capture pump (flush timer + unload listeners) and records a `pageview` on every
// route change. Uses window.location.pathname (not usePathname) for the captured
// value so it's the TRUE full path in both apps — under Analyse's basePath
// '/paddles', usePathname() omits the prefix, which would collide with att paths;
// the full path keeps `/paddles/new` distinct from any other `/new`.
// usePathname is only the change trigger.
export default function Analytics() {
  const pathname = usePathname()

  useEffect(() => { startAnalytics() }, [])

  useEffect(() => {
    if (pathname && typeof window !== 'undefined') {
      // `campaign` tags a visit that arrived on a ?campaign= link, so the
      // dashboard can count each campaign's visits. The path has share ids,
      // handles and tracker ids replaced (publicPath).
      const campaign = campaignFrom(window.location.search)
      capture('pageview', { path: publicPath(window.location.pathname), ...(campaign ? { campaign } : {}) })
    }
  }, [pathname])

  return null
}
