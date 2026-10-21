'use client'
// The fitted tide models (packages/waterways/data/tides.json, written by
// scripts/waterways/fit-tides.ts), typed once for the planner and print sheet,
// and Rijkswaterstaat's predicted Dutch high and low waters, loaded from the
// live data version only when a plan reaches tidal water in the Netherlands.
import { useEffect, useState } from 'react'
import tidesJson from '@paddlesnitch/waterways/data/tides.json'
import manifest from '@paddlesnitch/waterways/data/manifest.json'
import type { ComputedPlan } from '@paddlesnitch/waterways/plan'
import type { OfficialTides, TidesFile } from '@paddlesnitch/waterways/tide'
import { reachesDutchTide } from './plan-ui'

export const TIDES = tidesJson as unknown as TidesFile

let official: Promise<OfficialTides | null> | null = null
const loadOfficial = () => (official ??= fetch(`/plan/data/${manifest.version ?? 'none'}/tides-nl`)
  .then(r => (r.ok ? r.json() as Promise<OfficialTides> : null))
  .catch(() => { official = null; return null }))

/** Rijkswaterstaat's predictions, once a plan needs them (~100 KB, fetched once). */
export function useOfficialTides(plan: Pick<ComputedPlan, 'tidalFromM' | 'line' | 'finish'> | null | undefined): OfficialTides | null {
  const want = !!plan && reachesDutchTide(plan)
  const [tides, setTides] = useState<OfficialTides | null>(null)
  useEffect(() => {
    if (!want) return
    let live = true
    loadOfficial().then(t => { if (live) setTides(t) })
    return () => { live = false }
  }, [want])
  return want ? tides : null
}
