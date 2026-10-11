// Regions we build datasets for. A region is a bounding box plus the names of
// the navigations in it — the network keeps only those, so a route can't
// wander up a side stream.
import type { LatLng } from './types'

export type RegionConfig = {
  id: string
  name: string
  bbox: [number, number, number, number]   // [south, west, north, east]
  navigations: string[]
  /** Towns along the water, upstream first, for the planner's GO TO list. */
  places: { name: string; at: LatLng }[]
  /** A known route through the region, used to check the build. */
  check?: { name: string; start: LatLng; finish: LatLng; expectKm: number; expectPortages: number; source: string }
}

export const REGIONS: Record<string, RegionConfig> = {
  dw: {
    id: 'dw',
    name: 'Kennet & Avon Canal, River Kennet and the Thames to Westminster',
    bbox: [51.30, -2.05, 51.62, -0.10],
    navigations: ['Kennet and Avon Canal', 'River Kennet', 'Kennet', 'River Thames'],
    places: [
      { name: 'Devizes', at: [51.3553, -1.995] },
      { name: 'Pewsey Wharf', at: [51.3497, -1.7679] },
      { name: 'Great Bedwyn', at: [51.3797, -1.6] },
      { name: 'Hungerford', at: [51.4157, -1.5146] },
      { name: 'Kintbury', at: [51.404, -1.4466] },
      { name: 'Newbury', at: [51.4021, -1.322] },
      { name: 'Thatcham', at: [51.395, -1.261] },
      { name: 'Aldermaston Wharf', at: [51.406, -1.129] },
      { name: 'Theale', at: [51.437, -1.073] },
      { name: 'Reading', at: [51.458, -0.968] },
      { name: 'Sonning', at: [51.4745, -0.9136] },
      { name: 'Henley-on-Thames', at: [51.539, -0.901] },
      { name: 'Marlow', at: [51.567, -0.774] },
      { name: 'Cookham', at: [51.563, -0.708] },
      { name: 'Maidenhead', at: [51.523, -0.697] },
      { name: 'Windsor', at: [51.485, -0.607] },
      { name: 'Staines', at: [51.433, -0.515] },
      { name: 'Chertsey', at: [51.389, -0.491] },
      { name: 'Walton-on-Thames', at: [51.387, -0.417] },
      { name: 'Hampton Court', at: [51.403, -0.342] },
      { name: 'Kingston upon Thames', at: [51.411, -0.308] },
      { name: 'Teddington', at: [51.431, -0.322] },
      { name: 'Richmond', at: [51.459, -0.307] },
      { name: 'Kew', at: [51.484, -0.287] },
      { name: 'Putney', at: [51.467, -0.215] },
      { name: 'Westminster', at: [51.5008, -0.1217] },
    ],
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
