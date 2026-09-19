'use client'
import { useEffect, useState } from 'react'

// Does the viewer have a paddlesnitch tracker? This decides whether MY DEVICES
// appears in the account dropdown. A permanent row would point the large
// majority of people at a page with nothing on it, and the dropdown is the one
// piece of chrome on every page — so it is worth one small request to keep it
// honest.
//
// The answer is cached in module scope for the life of the page, so mounting or
// re-rendering the nav costs one request rather than N. A full navigation
// re-asks, which is exactly what makes a freshly paired tracker appear without
// the user having to know to hard-reload.
let cached: Promise<boolean> | null = null

export function useHasDevice(signedIn: boolean): boolean {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (!signedIn) return
    cached ??= fetch('/api/account/devices')
      .then(r => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices?: unknown[] }) => (d.devices?.length ?? 0) > 0)
      .catch(() => false)
    let live = true
    cached.then(v => { if (live) setHas(v) })
    return () => { live = false }
  }, [signedIn])
  return has
}

/** Test seam — drops the page-lifetime cache. */
export function __resetHasDeviceCache() { cached = null }
