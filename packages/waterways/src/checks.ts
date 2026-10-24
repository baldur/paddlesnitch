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
  /** Expected weirs along it, where a register lists them all. */
  expectWeirs?: number
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
  // The Netherlands (docs/features/waterways-netherlands.md): routes found, no counts pinned yet.
  { name: 'Amsterdam → Utrecht (Amsterdam-Rijnkanaal, Vecht)', start: [52.3795, 4.9000], finish: [52.0890, 5.1150], source: 'OSM; a route must exist' },
  { name: 'Rotterdam → Dordrecht (Nieuwe Maas, Oude Maas)', start: [51.9050, 4.4850], finish: [51.8150, 4.6700], source: 'OSM; a route must exist' },
  { name: 'Rotterdam → Zevenhuizen (De Rotte canoe route)', start: [51.9289, 4.4854], finish: [52.0288, 4.5583], source: 'OSM route=canoe "Kanonetwerk De Rotte"; a route must exist' },
  // Belgium (docs/features/waterways-belgium.md): routes found, no counts pinned yet.
  { name: 'Houyet → Anseremme (Lesse kayak run)', start: [50.1907, 5.0074], finish: [50.2357, 4.9041], source: 'The classic 21 km Lesse descent; a route must exist' },
  { name: 'Ghent → Bruges (Kanaal Gent-Brugge)', start: [51.0870, 3.6591], finish: [51.2028, 3.2352], source: 'OSM; a route must exist' },
  { name: 'Brussels → Charleroi (canal)', start: [50.8489, 4.3327], finish: [50.4130, 4.4244], source: 'OSM; a route must exist' },
  // France (docs/features/waterways-france.md): routes found, no counts pinned yet.
  { name: 'Toulouse → Castelnaudary (Canal du Midi)', start: [43.6151, 1.4339], finish: [43.3158, 1.9507], source: 'OSM; a route must exist' },
  { name: 'La Roque-Gageac → Beynac (Dordogne)', start: [44.8242, 1.2189], finish: [44.8367, 1.1296], source: 'The Dordogne canoe descent; a route must exist' },
  { name: 'Ruoms → Vallon-Pont-d’Arc (Ardèche)', start: [44.4440, 4.3480], finish: [44.3975, 4.3935], expectWeirs: 5, source: 'ROE: Sous Roche, Moulin de Sampzon, Mas Neuf, Gos and Vallon Salavas, each with a canoe pass' },
  { name: 'Paris: Pont d’Iéna → Pont d’Austerlitz (Seine)', start: [48.8600, 2.2918], finish: [48.8437, 2.3679], source: 'OSM; a route must exist' },
  // Germany (docs/features/waterways-germany.md): routes found, no counts pinned yet.
  { name: 'Minden → Hannover (Mittellandkanal)', start: [52.3010, 8.9180], finish: [52.4230, 9.6938], source: 'OSM; a route must exist' },
  { name: 'Weilburg → Limburg (Lahn)', start: [50.4860, 8.2620], finish: [50.3890, 8.0660], source: 'The Lahn canoe run, with its locks; a route must exist' },
  { name: 'Berlin: Oberbaumbrücke → Museumsinsel (Spree)', start: [52.5019, 13.4458], finish: [52.5190, 13.4000], source: 'OSM; a route must exist' },
  // Austria and Switzerland (docs/features/waterways-austria-switzerland.md): routes found, no counts pinned yet.
  { name: 'Melk → Krems (Danube, the Wachau)', start: [48.2310, 15.3340], finish: [48.4060, 15.6010], source: 'OSM; a route must exist' },
  { name: 'Bern: Eichholz → Altenberg (Aare)', start: [46.9320, 7.4560], finish: [46.9540, 7.4500], source: 'The Aare swim and paddle run through Bern; a route must exist' },
  { name: 'Zürich: Bellevue → Rapperswil (Lake Zurich)', start: [47.3650, 8.5450], finish: [47.2260, 8.8150], source: 'OSM; a route must exist' },
  // Denmark and Sweden (docs/features/waterways-denmark-sweden.md): routes found, no counts pinned yet.
  { name: 'Silkeborg → Ry (Gudenå, through the lakes)', start: [56.1690, 9.5530], finish: [56.0880, 9.7700], source: 'The Gudenå canoe route; a route must exist' },
  { name: 'Borensberg → Motala (Göta kanal)', start: [58.5600, 15.2850], finish: [58.5400, 15.0450], source: 'OSM; a route must exist' },
  { name: 'Stockholm: Kungsholmen → Slussen', start: [59.3270, 18.0300], finish: [59.3200, 18.0720], source: 'OSM; a route must exist' },
]
