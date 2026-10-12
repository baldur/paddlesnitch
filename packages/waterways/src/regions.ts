// Regions we build datasets for. A region is a bounding box plus the names of
// the navigations in it — the network keeps only those, so a route can't
// wander up a side stream.
import type { LatLng } from './types'

export type RegionConfig = {
  id: string
  name: string
  bbox: [number, number, number, number]   // [south, west, north, east]
  navigations: string[]
  /** A known route through the region, used to check the build. */
  check?: { name: string; start: LatLng; finish: LatLng; expectKm: number; expectPortages: number; source: string }
}

/** The national dataset's region id, stored on plans made on it
 *  (docs/features/waterways-uk-ireland.md). */
export const NATIONAL = 'gbie'

export const REGIONS: Record<string, RegionConfig> = {
  dw: {
    id: 'dw',
    name: 'Kennet & Avon Canal, River Kennet and the Thames to Westminster',
    bbox: [51.30, -2.05, 51.62, -0.10],
    navigations: ['Kennet and Avon Canal', 'River Kennet', 'Kennet', 'River Thames'],
    check: {
      name: 'Devizes Wharf to Westminster Bridge',
      start: [51.355333, -1.994961],    // CRT wharves: Devizes Wharf (KA-086-004)
      finish: [51.500833, -0.121667],   // Westminster Bridge
      expectKm: 201,                    // "125 miles" — DW race handbook 2026, 1.3
      expectPortages: 77,               // DW race handbook 2026, 1.3
      source: 'https://www.dwrace.co.uk/s/DW-2026-Handbook-Final.pdf',
    },
  },
}
