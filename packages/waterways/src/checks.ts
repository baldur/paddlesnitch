// Known routes the national build must get right. A build that breaks one
// fails (docs/features/waterways-uk-ireland.md, "Check routes").
import type { LatLng } from './types'

export type CheckRoute = {
  name: string
  start: LatLng
  finish: LatLng
  /** Expected length within ±3%, when a reliable figure exists. */
  expectKm?: number
  /** Expected locks along it, once that nation's lock sources are in. */
  expectLocks?: number
  source: string
}

export const CHECK_ROUTES: CheckRoute[] = [
  { name: 'Devizes → Westminster', start: [51.355333, -1.994961], finish: [51.500833, -0.121667], expectKm: 201.3, expectLocks: 78, source: 'DW race: 125 miles, 77 portages. Locks ≠ portages: we count Richmond half-tide lock (from OSM), which the race passes on the tide; the race counts Dreadnought Reach, which is not a lock' },
  { name: 'Lechlade → Teddington (Thames)', start: [51.6912, -1.6894], finish: [51.4318, -0.3244], expectLocks: 45, source: 'EA: St John’s to Teddington, 45 locks' },
  { name: 'Corpach → Clachnaharry (Caledonian Canal)', start: [56.8428, -5.1228], finish: [57.4915, -4.2648], expectLocks: 29, source: 'Scottish Canals: 60 miles, 29 locks' },
  { name: 'Northampton → Peterborough (Nene)', start: [52.2318, -0.8925], finish: [52.5693, -0.2415], expectLocks: 37, source: 'EA River Nene map (uMap): the Nene locks from Northampton to Peterborough' },
  { name: 'Bedford → Denver (Great Ouse)', start: [52.134, -0.465], finish: [52.5815, 0.354], source: 'EA: Great Ouse navigation, by the Old West River (locks from OSM; 17 found)' },
  { name: 'Tonbridge → Allington (Medway)', start: [51.196, 0.2735], finish: [51.2945, 0.5025], source: 'EA: Medway navigation (9 of about 10 locks, most from OSM lock gates; 2026-10-18)' },
  { name: 'Lanesborough → Athlone (Shannon, across Lough Ree)', start: [53.6735, -7.9895], finish: [53.4235, -7.9415], source: 'Waterways Ireland' },
  { name: 'Athlone → Banagher (Shannon)', start: [53.4235, -7.9415], finish: [53.1905, -7.9905], source: 'Waterways Ireland' },
  { name: 'Dublin → Shannon Harbour (Grand Canal)', start: [53.3335, -6.2390], finish: [53.2205, -7.9420], source: 'Waterways Ireland: 131 km; locks 1–36 plus the Circular Line locks in Dublin' },
]
