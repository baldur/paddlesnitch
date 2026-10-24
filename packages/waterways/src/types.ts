// The river planner's domain. See docs/features/river-planner.md.
// Coordinates are always [lat, lng], like the rest of the platform.
import type { LatLng } from '@paddlesnitch/timing/types'

export type { LatLng }

/** Where a fact came from. Every feature carries one, so a source can be
 *  credited on screen and in print, and withdrawn without hunting for it. */
export type SourceRef = {
  source: SourceId
  sourceId?: string          // the record's id in that source
  url?: string               // a page a person can open to check it
  fetchedAt: string          // ISO
}

export type SourceId =
  | 'crt'                    // Canal & River Trust ArcGIS services
  | 'ea-thames-locks'        // GOV.UK "River Thames: locks and facilities for boaters"
  | 'ea-thames-site-guides'  // GOV.UK lock-and-weir site guides
  | 'ea-aims'                // EA asset register: weirs and slipways (OGL)
  | 'ea-umap'                // EA uMap maps: Nene locks and facilities, Anglian notices (no licence stated)
  | 'sepa'                   // SEPA Obstacles to Fish Passage (OGL)
  | 'ea-levels'              // EA flood-monitoring river levels (live, OGL)
  | 'sepa-levels'            // SEPA river levels (live, OGL)
  | 'opw-levels'             // OPW waterlevel.ie (live, CC BY 4.0)
  | 'rws-levels'             // Rijkswaterstaat water heights (live, open data)
  | 'waterinfo-levels'       // Flemish water levels, waterinfo.be (live, CC BY 4.0)
  | 'pegelonline-levels'     // German federal water levels, PEGELONLINE (live, DL-DE Zero 2.0)
  | 'bafu-levels'            // Swiss federal water levels, BAFU (live, free use, source recommended)
  | 'smhi-flows'             // Swedish river flows, SMHI (live, CC BY 4.0)
  | 'thames-conditions'      // GOV.UK River Thames current conditions (live, OGL)
  | 'amber'                  // AMBER-GB barrier atlas (CC BY 4.0)
  | 'ifi'                    // Inland Fisheries Ireland barriers (CC BY 4.0)
  | 'amber-eu'               // AMBER Atlas of Instream Barriers in Europe, Belgium (CC BY 4.0)
  | 'roe'                    // France's register of river obstacles, OFB/Sandre (Licence Ouverte 2.0)
  | 'rws-fis'                // Rijkswaterstaat FIS/VNDS: Dutch locks and slipways (CC0)
  | 'nl-waterboards'         // Dutch water boards' weirs, dams, pumping stations, locks (CC BY-SA 4.0, own file)
  | 'scottish-canals'        // Scottish Canals open data (OGL)
  | 'waterways-ireland'      // Waterways Ireland ArcGIS layers (non-commercial)
  | 'osm'                    // OpenStreetMap (kept in its own table — ODbL)
  | 'contribution'           // a paddler's public contribution (CC0)
  | 'curated'                // drawn by us, committed in the repo

/** One stretch of river or canal between two junctions (from OSM ways). */
export type NetLink = {
  id: string
  name: string               // '' when unnamed
  form: 'canal' | 'inlandRiver' | 'tidalRiver'
  from: string               // OSM node id, 'n123'
  to: string
  line: LatLng[]
  lengthM: number            // length of `line` as drawn (not OS's nominal length)
  /** Can you paddle it, by OSM's canoe/boat tags: 'yes', 'no', or unset when
   *  untagged. Routing prefers 'yes' (the navigation) and avoids 'no'. */
  boat?: 'yes' | 'no'
  culvert?: true             // underground: never route through one
  canoeRoute?: string        // the marked canoe route it's part of (OSM route=canoe)
}

export type FeatureKind =
  | 'lock'
  | 'weir'
  | 'portage'
  | 'access'                 // a place to get on or off the water
  | 'facility'               // water, toilet, Elsan, shower…
  | 'crew_point'             // where a support crew can reach the bank
  | 'slipway'
  | 'hazard'

export type Facility =
  | 'toilet' | 'shower' | 'drinking_water' | 'elsan' | 'refuse'
  | 'card_payment' | 'electric_charging' | 'pump_out'

export type LockDetail = {
  postcode?: string
  gridRef?: string
  facilities?: Facility[]
  notice?: string            // a current closure / diversion notice
}

export type PortageDetail = {
  side?: 'left' | 'right'    // looking downstream. Unknown stays unknown — never guessed
  takeOut?: LatLng
  putIn?: LatLng
  carryM?: number
  rollers?: boolean
  notes?: string
}

export type CrewDetail = {
  postcode?: string
  directions?: string        // how to get there on foot / by road
  parking?: string
  walkM?: number             // car to bank
}

export type Feature = {
  id: string
  kind: FeatureKind
  name?: string
  at: LatLng
  source: SourceRef
  lock?: LockDetail
  portage?: PortageDetail
  crew?: CrewDetail
  hire?: true               // canoe, kayak or paddleboard hire here (OSM)
  weir?: { heightM?: number; canoePass?: boolean }  // measured height, where the source has one; a canoe pass beside it (ROE)
  facilities?: Facility[]
  photos?: string[]          // URLs published by the source
}

/** An OpenStreetMap element kept unmodified, apart from choosing which ones.
 *  ODbL share-alike stays inside this table — never copy its fields into a
 *  Feature (docs/features/river-planner.md, "Licence layers"). */
export type OsmElement = {
  id: string                 // 'node/123', 'way/456'
  at: LatLng                 // a node's position, a way's centre
  tags: Record<string, string>
  ends?: [LatLng, LatLng]    // a portage path's two ends
}

/** A built region: the navigable network plus everything we know along it. */
export type RegionDataset = {
  region: string
  builtAt: string
  bbox: [number, number, number, number]   // [south, west, north, east]
  links: NetLink[]
  features: Feature[]
  osm: OsmElement[]
}
