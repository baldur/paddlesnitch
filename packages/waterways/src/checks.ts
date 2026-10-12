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
  { name: 'Devizes → Westminster', start: [51.355333, -1.994961], finish: [51.500833, -0.121667], expectKm: 201.3, expectLocks: 77, source: 'DW race: 125 miles, 77 portages' },
  { name: 'Lechlade → Teddington (Thames)', start: [51.6912, -1.6894], finish: [51.4318, -0.3244], source: 'EA: St John’s to Teddington' },
  { name: 'Corpach → Inverness (Caledonian Canal)', start: [56.8428, -5.1228], finish: [57.4930, -4.2556], source: 'Scottish Canals: 60 miles, 29 locks' },
  { name: 'Lanesborough → Athlone (Shannon, across Lough Ree)', start: [53.6735, -7.9895], finish: [53.4235, -7.9415], source: 'Waterways Ireland' },
  { name: 'Athlone → Banagher (Shannon)', start: [53.4235, -7.9415], finish: [53.1905, -7.9905], source: 'Waterways Ireland' },
  { name: 'Dublin → Shannon Harbour (Grand Canal)', start: [53.3335, -6.2390], finish: [53.2205, -7.9420], source: 'Waterways Ireland: 131 km' },
]
