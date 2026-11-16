'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { capture, startAnalytics, isFirstPageview, _config } from './analytics'
import { campaignFrom, fromOwnSite, publicPath, refFrom, utmFrom } from './metrics-events'

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
      capture('pageview', {
        path: publicPath(window.location.pathname),
        ...(campaign ? { campaign } : {}),
        ...(_config.enabled && isFirstPageview() && !fromOwnSite(document.referrer, window.location.hostname) ? visitSource() : {}),
      })
    }
  }, [pathname])

  return null
}

/** The tab's first page view only (#906), unless one of our own pages opened
 *  the tab (that's the same visit): where it came from. The referring site's
 *  host name (never the full URL) and the landing page's utm tags; the server
 *  puts them on a visit record without the tab id. */
function visitSource(): Record<string, string> {
  const ref = refFrom(document.referrer, window.location.hostname)
  return { visit: '1', ...(ref ? { ref } : {}), ...utmFrom(window.location.search) }
}
