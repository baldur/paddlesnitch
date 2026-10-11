# Feature spec: River planner

**Status:** 🚧 **P0 built**, 2026-10-11: the `@paddlesnitch/waterways` package, ingest, and the Devizes→Westminster dataset plus coverage report. No UI yet.
**Owners:** Baldur (product), Claude (implementation).
**Prototype:** the Thames 200 crew page (`thames200-crew.s3.eu-west-1.amazonaws.com/index.html`), a hand-built, single-race version of this idea.

## Why

Planning a long paddle on a river or canal means collecting dozens of small facts from a dozen places:
- where each lock is
- which bank you get out on and how far you carry
- where you can get back in
- where a support crew can park and how far they then walk
- whether there's water or a toilet
- what the river is doing today, and for the tideway, when the tide turns

Today a paddler, or a Devizes to Westminster crew, builds this by hand in spreadsheets and printouts.

The river planner does it from two clicks on a map: start, finish, one-way or return. It returns every portage, access point and crew meeting point between them, with arrival times at your pace, and prints a paper copy to carry in the boat or the car.

The open data has a real gap: portages and crew access are barely mapped anywhere. Filling that gap is part of the product. Paddlers add what they know, privately first, and can choose to share it so the next paddler benefits. We say openly where the data is thin so people know where help is needed.

**First stretch:** Devizes to Westminster (the DW route). That's about 200 km and 77 portages across three navigation authorities: the Kennet & Avon Canal, the River Kennet and the non-tidal Thames, then the tidal Thames from Teddington. The model is built for any UK waterway first, then Europe.

## Where it lives

- **One app.** It's a new section of `apps/web`, not a new Next app, since the platform is one app (see [`unified-app-and-api.md`](unified-app-and-api.md)).
  - **Name:** **Plan**, at `/plan`, with a PLAN tab in `AppShell` next to TRIALS and PADDLES.
  - Section layout with `{ default, template }` titles (`page-titles.test.ts`).
- **New package `@paddlesnitch/waterways`** for the domain: route geometry, features, route projection and plan computation. It is pure except for a separate `waterways-store` server subpath, following the same pure/server split as `analysis` and `analysis-store`.
- **tRPC router** `plan` in `@paddlesnitch/api` for JSON. Photo uploads stay REST multipart, like the trace upload.
- **Reuses** `@paddlesnitch/timing/conditions` (EA flow, Open-Meteo weather) and `geo` (haversine; `projectRoute` for snapping a click onto a line).

## Data sources

Checked 2026-10-11. Licence decides what we may store, show and print, so every feature records where it came from.

| Need | Source | Licence | Notes |
|---|---|---|---|
| K&A locks, weirs, slipways, wharves | Canal & River Trust open data hub (ArcGIS FeatureServer, GeoJSON) | **OGL** | 1,722 locks nationally, 106 on the K&A. No portage side or landing points. |
| K&A facilities and crew access | CRT public services not listed on the hub: `Customer_Service_Facilities_View_Public` (toilet, water, Elsan… as Yes/No flags) and `Towpath_Access_Points` (steps or slope, width) | No licence stated (used with credit) | Found during P0. 348 towpath access points in the DW box. Their photo fields point at CRT's private SharePoint, so photos can't be shown. |
| Thames locks and facilities | GOV.UK "River Thames: locks and facilities for boaters" | **OGL v3** | HTML only, so we scrape it. Toilets, water and so on per lock. No parking or portage info. |
| Getting to a Thames lock by land and where to park | GOV.UK EA lock-and-weir site guides | **OGL v3** | The prototype's "find" and "park" text. HTML, scraped per lock. |
| Route network (centrelines and junctions) | **OSM** `waterway=river` and `canal` ways via Overpass, split at every junction | ODbL | OS Open Rivers was tried first and dropped: it carries canals only where they're part of the drainage network, so most of the K&A summit pound is missing (2.8 km of about 15 km between Pewsey and Crofton). **Not** the CRT centrelines (no redistribution). |
| Lock gates, weirs, slipways, amenities | OpenStreetMap (Overpass for small areas, Geofabrik for bulk) | **ODbL** | Good for gates, weirs and slipways. Almost no portages: 3 tagged in the whole DW bounding box, and 0 put-ins. |
| River level and flow | EA flood-monitoring API (already used) | OGL | Teddington, Molesey, Kingston, plus tidal Richmond and Westminster. Needs the EA attribution line. Not for safety-critical use. |
| Thames stream warnings (red and yellow boards) | GOV.UK "River Thames: current river conditions" | OGL | **No feed**, so we parse the page, which is updated almost daily, reach by reach from St John's to Teddington. |
| Tide predictions | **Our own harmonic fit** on EA observed tide-gauge levels (OGL), with `@slackwater/engine` (MIT, TypeScript) | OGL data, MIT code | No API, no account, any date ahead, works offline in print. See "Tides" below. ADMIRALTY is out (needs an account). PLA predictions are explicitly prohibited. |
| Observed tidal level | EA tide gauges (Richmond, Westminster) | OGL | Observations, not predictions. |
| Satellite and aerial imagery | EOX Sentinel-2 cloudless **2016** (CC BY 4.0); EA Vertical Aerial Photography (OGL, 10–50 cm, patchy coverage, we self-host the tiles) | CC BY / OGL | Later EOX years are non-commercial. **Esri and Bing are not for print.** Esri's terms only cover viewing on screen. |
| Basemap | OS Open Zoomstack (vector); current Esri Gray Canvas on screen | OGL / Esri | Print uses OS or OSM-rendered tiles. |
| Europe, first | Rijkswaterstaat FIS (NL locks and chambers, WFS) | **CC0** | Cleanest European source. Then EuRIS (EU, "open data", to confirm), German WSV inland ENCs (DL-DE Zero, to confirm). France's VNF has no open lock dataset. |

**Sources with no licence shown:**
- the DW race portage diagrams and Tideway notes (`dwrace.co.uk`)
- Paddle UK PaddlePoints
- CanalPlan

**Decided (owner, 2026-10-11):** we use these with a clear credit and link to where each fact came from, and stop if the owner asks. paddlesnitch is a free utility; anyone who pays does so to support running it. Every feature's `source` records the origin, so one source can be withdrawn without hunting through the data.

**Explicit prohibitions are different from a missing licence.** A source whose terms forbid our use stays out:
- PLA tide predictions say "use in any other product or service is prohibited". ADMIRALTY covers tides instead.
- Esri imagery must not be printed.
- CRT centrelines forbid redistribution.

### Licence layers (keeps share-alike contained)

Three stores, joined by ID and **never merged row-into-row**:

1. **Core:** OGL and CC0 data and data with no stated licence (CRT, EA), plus what we draw ourselves (portage geometry). Attribution list kept per source.
2. **OSM layer:** the route network (`links`) and OSM points (`osm`), stored unmodified apart from selection and simplification, and linked by OSM ID. ODbL share-alike stays inside this table (a "collective database"). Printed maps are "produced works" and carry "© OpenStreetMap contributors".
3. **Contributions:** user-submitted material. When a contributor makes something public, they release it under **CC0**: as free as possible, reusable by anyone, including other open projects. We still show the contributor's display name as a courtesy, though the licence doesn't require it. Until then it is private and unlicensed to anyone else.

A public `/plan/sources` page lists every source, its licence and its attribution. The `legal-claims.test.ts` privacy guard means the privacy page must name every outside host the app calls at runtime. The P0 ingest hosts (ArcGIS, Overpass, gov.uk) are only called by the build script on a developer's machine, so the guard lists them as `BUILD_TIME_SOURCES`. Any that the app later calls live (EA levels, EOX tiles) move to the privacy page.

## Domain model

All coordinates are `[lat, lng]`. Distance along a route is **chainage**: metres from the route's start. Chainage is computed per route, not stored per waterway, because a route can cross several waterways (canal → Kennet → Thames) and a return trip runs the other way. Features are stored by position only; `along()` projects them onto a route to get chainage and the bank they're on.

```ts
type NetLink = {             // one stretch of river or canal between two junctions (OSM)
  id: string; name: string
  form: 'canal' | 'inlandRiver' | 'tidalRiver'
  from: string; to: string   // OSM node ids
  line: LatLng[]
  lengthM: number
}
```

As built (`packages/waterways/src/types.ts`; the sketch below is the original design, kept for the fields still to come):

```ts
type FeatureKind =
  | 'lock' | 'weir' | 'portage' | 'access'      // access = put-in / take-out
  | 'facility'                                  // water, toilet, Elsan, café, shop
  | 'crew_point'                                // where a crew can park and meet
  | 'hazard' | 'bridge' | 'tunnel'

type Feature = {
  id: string
  kind: FeatureKind
  name?: string
  waterwayId: string
  chainageM: number
  at: LatLng
  source: SourceRef          // { dataset, licence, sourceId?, fetchedAt }
  osmId?: string             // link into the OSM side-table, never copied in
  detail?: LockDetail | PortageDetail | CrewPointDetail | FacilityDetail
}

type PortageDetail = {
  side: 'left' | 'right'         // in the direction of travel, downstream by default
  takeOut: LatLng; putIn: LatLng
  carryM: number                 // walked distance, drawn as a line
  rollers?: boolean
  notes?: string
  status?: 'open' | 'closed' | 'unknown'
}

type CrewPointDetail = {
  postcode?: string
  parking?: string               // e.g. EA "park" text: "no parking at the lock; NT car park in Buscot…"
  walkM?: number                 // car to bank
  directions?: string            // EA "find" text
  payAndDisplay?: boolean
}
```

**Coverage** is computed, never hand-typed. For each feature we score which expected fields are known: a portage needs side, take-out, put-in and carry distance; a crew point needs parking and walk distance. Each waterway reach gets a percentage. That is how we stay honest about gaps (see below).

### Plans

```ts
type Plan = {
  id: string; userId: string
  title: string
  start: { waterwayId: string; chainageM: number }
  finish: { waterwayId: string; chainageM: number }
  shape: 'one_way' | 'return'      // return = out to finish, back to start
  startAt?: string                 // ISO; drives ETAs, daylight and tide window
  paceKmh: number                  // moving pace
  portageMinutes: number           // per portage, default 3
  stops: PlanStopOverride[]        // user's crew meets, food stops, skip/keep flags
  attachments: string[]            // contribution ids attached to this plan
  visibility: 'private' | 'link'   // unlisted share link, like paddle sharing (#202)
}
```

The computed plan (never stored, always derived) is the ordered list of features between start and finish in travel direction. Each entry carries:
- the distance from the previous stop
- ETA from `startAt` and pace, plus portage time
- daylight flags

For the tideway it also carries the tide state at Teddington and at the finish. Reversing direction flips portage sides relative to the paddler.

Routing across waterways uses the `joins` graph. It's a tiny graph, so a simple BFS is enough, not a routing engine.

### Contributions (your own information)

```ts
type Contribution = {
  id: string; userId: string
  kind: 'note' | 'photo' | 'drawing' | 'map_snippet' | 'correction'
  featureId?: string              // attached to a lock/portage/etc.
  at?: LatLng                     // or a free position on the waterway
  body?: string                   // note text / correction
  media?: { key: string; w: number; h: number }   // S3 key; EXIF + GPS stripped on upload
  geometry?: LatLng[][]           // drawing: polylines over the map (e.g. the carry route)
  visibility: 'private' | 'public'
  licence?: 'CC0-1.0'             // set when made public
  status: 'private' | 'pending' | 'published' | 'rejected'
  createdAt: string
}
```

- **Map snippet:** a saved map view (bounds plus layers plus the user's drawing), rendered into the print.
- **Drawing:** polylines and points drawn on the map, for example "the carry path goes round the back of the lock cottage".
- **Correction:** "this portage is on the left, not the right". Feeds moderation and can update the core field.
- **Making something public** shows a one-time grant: "you're releasing this under CC0, free for anyone to reuse; we'll show your display name next to it". Withdrawing it later stops it being shown. Copies already printed can't be recalled, and we say so.
- **GDPR:** included in the account export, deleted on erasure. The same paths as entries.

### Storage

**Built datasets** are committed for now at `packages/waterways/data/{region}.json`: 709 KB raw, 127 KB gzipped for the DW region. They're generated, reviewable in PRs, and tests run against them. P1 decides how they're served, as a static asset or from S3. Everything per user lives in S3 like the rest of the platform:

```
waterways/conditions/stream-warnings.json  ← last parsed board, cached ~1 h
plans/{userId}/{planId}.json
contributions/{userId}/{id}.json       ← owner copy (source of truth)
contributions/public/{featureId}/{id}.json  ← published index
contributions/media/{userId}/{id}.{jpg|webp}
```

The dataset is small: one region is a few thousand features, a few hundred KB gzipped. So the planner loads the region file and computes in the browser and server alike. No database.

## Ingest (as built in P0)

`pnpm --filter web waterways [region] [--refresh]` (`apps/web/scripts/waterways/build-region.ts`). Every raw response is cached under `apps/web/.cache/waterways/<region>/` (gitignored), so a rebuild doesn't hammer anyone. Parsing is pure, in `@paddlesnitch/waterways/ingest/*`, and tested against trimmed real responses in `apps/web/src/tests/fixtures/waterways/`.

1. **OSM** (`ingest/osm.ts`): Overpass, with mirror fallback and backoff. Rivers and canals named in the region config, plus every lock chamber and "… Cut", become the network. Ways are split wherever ways meet, because OSM joins a side channel to the middle of the main river's way. Lock gates, weirs, slipways, portages, water, toilets and parking go in the OSM layer.
2. **CRT** (`ingest/crt.ts`): locks, weirs, slipways, wharves, facilities and towpath access, by bounding box, paged.
3. **EA Thames** (`ingest/thames.ts`): through the GOV.UK Content API. Every lock's postcode, OS grid reference (converted to WGS84 by `osgb.ts`), facilities (anything "currently closed" or "out of use" is left out) and current notice. The 19 site guides add how to get there and where to park.
4. **Assemble** (`build.ts`): keep what's within 400 m of the network, merge locks that CRT and EA both map, attach site-guide crew detail to locks by name.
5. **Coverage report** (`packages/waterways/data/{region}-coverage.md`): routes the region's check route and scores every lock along it.

Hand-curated additions (portage lines we draw) will live in committed JSON beside the data, so they're reviewable in PRs.

### P0 result: Devizes → Westminster

- **Route:** 201.3 km from Devizes Wharf to Westminster Bridge on the OSM network. The race says 125 miles (201 km). No gaps.
- **Locks along it:** 77, matching the race's 77 portages. That's every K&A lock from 51 (Wootton Rivers) to 106 (County), Blake's, and the 20 Thames locks from Sonning to Teddington. The counts aren't the same thing, though: the race's 77 includes the compulsory portage at Dreadnought Reach, which isn't a lock. So one lock is probably not a separate race portage. The race's portage diagrams are images, so the lists haven't been matched one by one.
- **What we know per lock:**

  | Fact | Known for |
  |---|---|
  | Portage side, take-out, put-in | **0%**, the core gap |
  | Carry route | 1% (one OSM portage) |
  | Crew access | 79% |
  | Parking | 62% |
  | Facilities | 38% |

- **Not in any source:** the Dreadnought Reach portage, and Richmond half-tide lock (PLA, not CRT or EA).

### Tides

Researched 2026-10-11. No paid API, no sign-up.

- **Data:** the EA flood-monitoring API publishes observed tidal levels every 15 minutes under OGL. Westminster (`0006-level-tidal_level-i-15_min-mAOD`), Tower Pier (`0007-…`), Richmond (`0009-…`), Teddington Lock tail (`3401TH_TAOD-…`).
  - The daily archive (`/flood-monitoring/archive/readings-YYYY-MM-DD.csv`) only goes back to **2025-10-30**, so there's about 11 months of data so far. Each daily file is about 60 MB, for every station.
  - **Owner to-do:** ask the EA for the long gauge history, which goes back to 1988–89. That would allow a far better fit.
- **Method:** fit harmonic constituents offline with `@slackwater/engine` (MIT, pure TypeScript; formerly "neaps").
  - Fit Tower Pier and Westminster with about 30+ constituents, including the shallow-water M4, MS4, MN4, M6 and M8 that the upper estuary needs. The annual constituents (Sa, Ssa) can't be resolved from under a year of data.
  - Ship the constituents as static JSON and predict in the browser, so plans any date ahead work, and print works offline. Refit yearly.
- **Backtest before showing it:** against held-out EA observations, reporting the median and 95th-percentile error in high-water time.
- **Richmond and Teddington:** high water only, either fitted from Richmond or as Tower Pier plus the PLA's published +1:01, with credit. **No low-water time above Westminster.** Low water there is driven by Teddington flow.
- **Rejected:**
  - Global tide models (EOT20, FES, TPXO) don't resolve the river.
  - Open-Meteo Marine returns nulls at Westminster and only covers about 10 days.
  - The open constituent databases have no upper-Thames station; Sheerness is the nearest.
- **Shown with every tide:** "Predicted astronomical tide only. Surge, wind, pressure and river flow at Teddington can shift times by tens of minutes. Upstream low water is unreliable. Not for navigation: check PLA / Thames VTS on the day." Credit: "Contains Environment Agency data, OGL v3".

## Being open about gaps

- **Coverage on the map:** each reach is shaded by coverage, and each feature card shows "we don't know which side to land, do you?" with a one-tap correction.
- **A public `/plan/gaps` page:** per waterway, which locks lack portage side, take-out and put-in, carry distance, or crew parking, sorted by how often they appear in people's plans. That's where contributions help most.
- **No silent guessing.** An unknown portage side is shown as unknown, never defaulted to a likely side. A wrong guess sends someone to the wrong bank.

## The planner (UX)

1. Open `/plan` on a map of the waterways we cover. Areas we don't cover yet are greyed out.
2. Click a start, click a finish. Each click snaps to the nearest waterway, and we show the chainage and nearest named place. Choose **one-way** or **return**.
3. Set a start date and time, your pace and portage time (sensible defaults).
4. Get the **route sheet**: a stop list with distance, ETA, portage side and carry, crew parking and walk, and facilities. Portages and crew points are marked. Tideway sections show the tide window.
5. Add your own: notes, photos, drawings and map snippets on any stop, or anywhere on the route.
6. Save. Saving needs sign-in; using the planner doesn't. Optionally share an unlisted link with your crew.
7. **Print.**

### Print

- **A dedicated `/plan/[id]/print` page** with a print stylesheet. A4 portrait; A5 is optional for a map case. No PDF library: the browser's print-to-PDF covers it.
- **Contents:**
  - a summary page: route, distance, portages, start time, tide window, emergency numbers
  - then one block per stop: name, chainage, ETA, portage side and carry, crew parking with postcode and walk, facilities
  - a small static map per portage from **printable** tiles (OS Zoomstack or OSM-rendered, never Esri)
  - the user's own notes, photos and drawings
  - an attribution footer
- A crew sheet variant: crew points only, with drive order and postcodes, like the prototype.
- **High contrast and large type.** Readable wet, in a map case, in the dark under a head torch.

## Safety and honesty

Every view and print says the planner is not a navigation authority. Check stream warnings, notices and the tide before going, and the EA data is not for safety-critical use. Live stream warnings and tides show the time they were fetched. If a fetch fails, we say "unknown", never "no warning".

## Phases

| Phase | What | Done when |
|---|---|---|
| **P0 Data: DW stretch** ✅ | `@paddlesnitch/waterways` (OS grid conversion, routing, features along a route, coverage), ingest for OSM, CRT and GOV.UK Thames, the DW dataset and coverage report | Done 2026-10-11: route 201.3 km, 77 locks; tests cover parsers, routing and the built dataset (see "P0 result") |
| **P1 Planner** | `/plan` map, click start and finish, one-way or return, computed stop list with ETAs; save plans (signed-in) | Unit tests for snapping, chainage ranges, direction flip and return; E2E for click → stop list |
| **P2 Print** | Print page and crew sheet with printable static maps | Manual print check plus a render test of the print page |
| **P3 Your own information** | Private notes, photos (EXIF stripped), drawings, map snippets on a plan or feature; in print; GDPR export and erasure | Tests for ownership, privacy, export and erasure |
| **P4 Sharing and gaps** | Make-public with a CC0 release (live immediately; flag and hide), `/plan/gaps`, coverage shading, corrections | Permission story tests (private never leaks); gaps page lists the real holes |
| **P5 Live conditions** | Stream warnings (parsed), EA levels, tides (ADMIRALTY), daylight; in plan and print | Best-effort: a failed fetch shows "unknown", tested |
| **P6 UK-wide** | All CRT waterways plus the EA Thames upstream to Lechlade | Lechlade→Teddington locks match the prototype's list |
| **P7 Europe** | Netherlands (Rijkswaterstaat CC0) first, then EuRIS and Germany | One NL route plans end to end |

**Not in scope: races.** Plans are race-agnostic (owner, 2026-10-11). People train on these stretches far more often than they race them, and a race's checkpoints and rules are the organiser's job. No event layer, no cut-offs.

**Later:** live GPS tracking of a crew against the plan (trackers already exist, so this is a natural follow-on); offline/PWA.

## Decisions

Settled by the owner on 2026-10-11:

1. **Name:** **Plan**, at `/plan`.
2. **Contribution licence:** **CC0**, as free as possible. paddlesnitch stays a free utility; payment only ever supports running it.
3. **Races:** out of scope (see Phases).
4. **Sources with no licence:** used with credit until the source asks us to stop. Explicitly prohibited sources stay out.
5. **Tides:** no paid or sign-up APIs. ADMIRALTY is out (owner, 2026-10-11). We fit our own predictions from EA observations; see "Tides".

6. **Moderation:** public contributions **go live immediately**. Anyone signed in can flag one; the owner (and later trusted contributors) can hide it. Data wants to be free.
7. **Restrictions must be explicit.** We treat data as usable unless its publisher says otherwise, credit the source on every fact, and remove it on request.
