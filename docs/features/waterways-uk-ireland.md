# Feature spec: River planner data for the UK and Ireland

**Status:** 🚧 in progress, started 2026-10-12. **W1 and W2 built** (network, server routing, map by area, places search). **W3/W4 started:** CRT and the EA Thames nationally, Scottish Canals, Waterways Ireland. **W5 refresh built:** a weekly workflow and its own narrow AWS role. Production stays on the Devizes–Westminster data until the first national version is published and its PR merged. This is P6 of [`river-planner.md`](river-planner.md), widened from "all CRT waterways" to full coverage of England, Wales, Scotland, Northern Ireland and the Republic of Ireland.
**Research:** [`waterways-uk-ireland-sources.md`](waterways-uk-ireland-sources.md), the source inventory with licences and endpoints.

## Owner decisions (2026-10-12)

1. **Free, keyless data only.** No sign-up, no API key, no paid service. A source that needs a key waits (NRW river levels, Logainm, BODC).
2. **Non-commercial data is used while paddlesnitch makes no money.** Waterways Ireland's layers and EOX Sentinel-2 cloudless 2018+ are in. Each such source is tagged `commercial_use_allowed: false` in the registry so it can be dropped in one place if that changes, and **none of it ever feeds the CC0 contribution layer** (OpenPortage).
3. **Esri World Imagery for seeing the water.** On screen only, with tracing allowed and storing, printing and model training not allowed (see `river-planner.md`, "P1 as built").
4. **PaddlePoints is out.** Its terms grant rights only to Paddle UK and it sits behind a membership login. Paddle UK is a partner to approach, not a source.
5. **Scope order:** UK and Ireland to full coverage before Europe.

## What changes from P0

P0 built one region (Devizes to Westminster) from Overpass queries for named navigations, committed the result as `data/dw.json`, and computed plans in the browser. That doesn't scale:

| | Devizes → Westminster | UK and Ireland |
|---|---|---|
| Rivers and canals | 200 km | about 80,000 km (Ireland alone: 16,251 km of river, 694 km of canal) |
| Points in the network | about 15,000 | about 3 million before simplifying |
| Network file | 700 KB | tens of MB |

So:
- **The network comes from Geofabrik**, not Overpass: one weekly download of `britain-and-ireland-latest.osm.pbf` (2.6 GB, ODbL, rebuilt daily), filtered locally. Every `waterway=river` and `waterway=canal`, not just named navigations.
- **Routing moves to the server.** The planner sends the clicks to a tRPC procedure, which snaps them, routes, and returns the route line and the features along it. The browser still works out the times, so changing pace or start time needs no round trip.
- **The map draws the network by area.** The browser loads small per-area files for what's on screen, plus one coarse overview for zoomed-out views.
- **Published data moves out of git.** The national build goes to S3 under a version; git keeps a small manifest naming the live version, with its counts and coverage summary. Merging the PR that changes the manifest publishes the build; reverting it rolls back.
- **`dw.json` stays as a test fixture**, cut from the national build, so the existing DW tests (201.3 km, 77 locks) keep guarding routing.

## Organisation

### Source registry

**As built so far:** credits and licence flags live in `SOURCES` (`packages/waterways/src/sources.ts`, with `nonCommercial: true` on Waterways Ireland), and each source's fetch is a job in `apps/web/scripts/waterways/fetch-sources.ts`. The per-file registry below is where this goes once there are more sources than fit comfortably in one file.

The design: one TypeScript file per dataset, `packages/waterways/src/registry/{gb|ie}/{nation}/{publisher}-{dataset}.ts`, typed by `SourceEntry`:

```ts
type SourceEntry = {
  id: string                       // 'crt-locks', 'wi-infrastructure', 'osm-network'
  publisher: string
  website: string                  // where a person checks it
  data: string                     // the raw-data URL, not the portal
  protocol: 'arcgis' | 'govuk-content' | 'shapefile-zip' | 'geofabrik' | 'ckan' | 'html' | 'pdf-manual'
  layers: ('locks' | 'weirs' | 'access' | 'facilities' | 'hazards' | 'gauges' | 'network' | 'names')[]
  coverage: ('eng' | 'wls' | 'sct' | 'nir' | 'roi')[]
  cadence: 'weekly' | 'monthly' | 'static'
  status: 'candidate' | 'active' | 'broken' | 'withdrawn'
  licence: {
    name: string                   // 'OGL-UK-3.0', 'CC-BY-4.0', 'ODbL-1.0', 'non-commercial', 'none stated'
    commercial_use_allowed: boolean
    share_alike: boolean
    attribution: string            // the credit line shown on screen and in print
  }
  decision?: string                // the owner ruling that admitted it, e.g. 'owner 2026-10-12: non-commercial OK while free'
}
```

A source can be registered as `candidate` before it has a parser, so the registry is also the backlog. `SOURCES` (credits on `/plan/sources` and in print) is derived from the registry, so credits can't drift from what was ingested. Run state (last fetch, hash, feature count, errors) is machine-written next to the staged data, never in the registry.

### Pull jobs

Two kinds, one contract.
- **Dataset jobs** fetch a whole jurisdiction once: OSM from Geofabrik, CRT's national layers, the GOV.UK EA navigation pages, Scottish Canals, SEPA obstacles, AMBER-GB, Waterways Ireland, IFI barriers.
- **Locality jobs** cover one waterway each: a council slipway layer, an EA uMap, the Wye Paddle Guide. Manual ones (a PDF to transcribe) are GitHub issues whose output is a committed curated file.

Every job:
1. Reads its registry entry.
2. Checks cheaply whether anything changed (ArcGIS `editingInfo.lastEditDate`, GOV.UK `public_updated_at`, HTTP `ETag`/`Last-Modified`, Geofabrik's daily timestamp) and stops if not.
3. Fetches, and stores the raw response only if its hash is new.
4. Runs the pure parser (`packages/waterways/src/ingest/*`) to produce features in the shared schema, each carrying `source`, `sourceId` and the licence.
5. Writes `state.json`: when, the hash, counts, warnings.

### Staging

| Stage | Where | What |
|---|---|---|
| Raw | `waterways/raw/{source}/{date}-{hash}.{ext}` in the data bucket | Immutable snapshots, only when changed; deleted after 90 days. The Geofabrik file itself is not kept, only our filtered extract. Locally: `apps/web/.cache/waterways/` |
| Normalised | `waterways/normalised/{source}.json.gz` + `waterways/health.json` (built) | The last good copy of each source, our schema, before merging; health says per source whether this run's copy was used (`ok`), the staged one (`stale`) or neither (`missing`) |
| Published | `waterways/published/{version}/…` | The network for routing, area files for the map, features, places. Immutable; `version` is the build date plus a short hash |
| Live pointer | `packages/waterways/data/manifest.json` in git | The version the app serves, counts per nation and source, coverage summary |

Locally everything goes through `@paddlesnitch/core/storage`, so it lands under `.local-data/` in dev.

### Merging sources

The three licence layers stay as built (core, OSM, contributions) with one addition: non-commercial sources are a tagged slice of core. Two sources describing the same lock are matched by distance and name, as `build.ts` already does for CRT and EA. Precedence is per field: the authority wins on position and name; contributions win on portage side and landing.

### Scheduling

GitHub Actions, scheduled weekly (Sunday 02:17 UTC; off the hour, because runs on the hour get delayed or dropped):
- **refresh** (built: `.github/workflows/waterways-refresh.yml`, also runnable by hand): downloads the Geofabrik extract, runs `osm_extract.py`, `pnpm waterways:sources --stage` (see **health**) and `pnpm waterways:national` (checks), then assumes the `att-github-waterways` role, publishes the version to `s3://paddlesnitch-data-prod/waterways/published/{version}/` and opens a PR setting `manifest.json`, with the build summary. A PR opened with `GITHUB_TOKEN` starts no `pull_request` runs, so the job dispatches `checks.yml` and `e2e.yml` on its branch. While the repo setting "Allow GitHub Actions to create and approve pull requests" is off (it is, 2026-10-15), the job can't open the PR: it pushes the branch and opens an issue with the link instead, and a person opens the PR (which then runs the checks normally). Merge to publish; the deploy then serves the new version.
  - **The role** (`infra/lib/att-stack.ts`) trusts only jobs in the `waterways-data` environment and can read and write only `waterways/*` in the data bucket; `deploy-trust.test.ts` holds it there. The workflow derives its ARN from the deploy role's (same account). GitHub creates the environment on the first run; restricting it to `main` under Settings → Environments is worth doing.
  - Raw snapshots under `waterways/raw/` expire after 90 days. Published versions are kept: the live one is named in git.
- **discover** (built: the `discover` job in the same workflow; `pnpm waterways:discover [--days 8]` by hand): searches data.gov.ie and OpenDataNI (CKAN), ArcGIS Online, and since 2026-10-21 the Dutch register data.overheid.nl (CKAN, Dutch terms: sluis, stuw, kano, trailerhelling, overdraagplaats, aanlegplaats; it re-harvests datasets, so the ones we use are in `KNOWN` by title) for datasets *created* in the last week whose titles mention locks, weirs, sluices, slipways, portages, canoes, kayaks, blueways, towpaths, launches, canals or barriers, and posts one digest issue a week when there's anything. Pure filtering in `packages/waterways/src/discovery.ts`:
  - created, not modified: the catalogues re-touch "modified" on every harvest, so it would list the same old datasets weekly;
  - ArcGIS items must sit inside Britain and Ireland: its bbox search matches anything overlapping, including world-extent survey forms, which are dropped too;
  - one search per term on the title: a single OR'd query matches every field and fills the results with noise;
  - sources already used or turned down are in `KNOWN`, so they don't come back;
  - data.gov.uk is left out (no working search API, 2026-10); OpenDataNI's firewall refuses user agents that don't look like a browser, so the script sends `Mozilla/5.0 paddlesnitch`.
- **health** (built: `packages/waterways/src/health.ts`): with `--stage`, every good copy of a source is kept at `waterways/normalised/{source}.json.gz`. A source that errors, comes back empty or with under half the features of its last good copy uses that staged copy instead and is marked `stale`, so a broken API can't silently empty part of the map. Nothing staged → `missing`. The per-source lines go in the data PR. A source with three runs in a row without a fresh copy opens a "Waterways source X is failing" issue (one at a time).
  - Change detection and raw snapshots (below, in "Pull jobs") aren't built: fetching everything weekly takes a few minutes and costs nothing, so they'd only save the sources' servers a little.

Live river levels and tides are not part of this pipeline; they're fetched when a plan is opened.

### Cost

| Item | Monthly |
|---|---|
| GitHub Actions (public repo, standard runners) | $0 |
| S3: raw snapshots (90-day expiry), normalised files, published versions | well under $1 |
| CloudFront to browsers (1 TB/month free tier) | $0 at current traffic |
| Lambda for routing (a route is well under a second) | about $5 per million plans |

## Network and routing

- **Selection:** every `waterway=river`, `canal`, `flowline` and `fairway` way. `flowline` carries the water across lakes: without it the Caledonian Canal stops at Loch Lochy. Streams, ditches and drains are out. Ways are split at every shared node, as in P0. Result (2026-10-12): 80,540 links, 63,295 km; the whole build takes about 6 seconds after a 100-second extract.
- **Cost:** OSM's `canoe`/`boat` tags. Water tagged yes (the navigations) costs its length, untagged twice, no or private four times, culverts fifty times. Without this the Devizes–Westminster route took the Jubilee River and the Duke of Northumberland's River and came out 7 km short; with it, 201.4 km through the real lock cuts. A penalty for changing waterway name was tried and dropped: the K&A legitimately alternates between canal and River Kennet.
- **Server:** the routing data (network 36 MB raw, 10 MB gzipped; features; places) is loaded once per Lambda instance from the published version and kept in memory, with a grid index for snapping. The OSM points layer is published but not loaded: routing doesn't need it. One procedure, `plan.route`, takes `{ start, finish?, shape }` and returns the snapped ends and, with both, the route line and every feature along it with its chainage and bank. Timing (`timePlan`) stays pure and runs in the browser.
- **Check routes** (a build fails if one breaks):

| Route | Expect | Source |
|---|---|---|
| Devizes → Westminster | 201 km (found: 201.4 km, 78 locks: the race's 77 portages include Dreadnought Reach, not a lock, and leave out Richmond half-tide lock, passed on the tide) | DW race |
| Lechlade → Teddington | 45 Thames locks (found: 199.6 km, 45; EA says 124 miles) | EA |
| Corpach → Clachnaharry (Caledonian Canal) | 29 locks (found: 94.1 km, 29; 60 miles) | Scottish Canals |
| Northampton → Peterborough (Nene) | 37 locks (found: 94.2 km, 37) | EA River Nene map |
| Bedford → Denver (Great Ouse) | connected (found: 96.0 km, 17 locks from OSM) | EA |
| Tonbridge → Allington (Medway) | connected (found: 28.5 km, 6 locks) | EA |
| Lanesborough → Athlone (Shannon, across Lough Ree) | connected through the lough | Waterways Ireland |
| Athlone → Banagher (Shannon) | connected | Waterways Ireland |

## EA rivers beyond the Thames (2026-10-16)

The EA's GOV.UK pages for the Medway, Nene, Great Ouse, Stour, Welland & Glen, Black Sluice and Ancholme list locks by name only, with no grid references. Positions come from three places:
- **EA uMap maps** (no licence set, used with credit): "The River Nene" has every Nene lock by name, plus water points, Elsan and weir warnings. The "Navigation Notices" maps for the Nene, Great Ouse, Stour, Welland & Glen and Ancholme carry current closures and hazards, such as "Bures Mill Downstream Canoe Portage - Closed". They become hazards prefixed "Notice:"; the weekly refresh keeps them current.
- **EA asset register (AIMS Structure, OGL):** every EA weir (2,841) and slipway (149). Its navigation lock gates cluster into only 125 locks, 73 of them on the Thames, so it isn't used for locks.
- **OSM lock chambers** (`lock=yes` ways, ODbL): published in their own file, `osm-features.json`, and used only where no authority's lock is within 120 m. They count on a route only within 60 m of it (a chamber is drawn on the water, an authority's point beside it), and boat rollers and private marina locks are skipped. This fills the Great Ouse (Bedford → Denver: 17 locks) and part of the Medway (6 of about 10).

Still without lock positions: the Ancholme and four Medway locks. They show as gaps.

## Weirs from the barrier inventories (2026-10-16)

Two fish-passage inventories give weirs a paddler meets, everywhere the navigation authorities don't:
- **SEPA Obstacles to Fish Passage** (Scotland, OGL): weirs, dams, sluices; natural waterfalls become hazards named "Waterfall".
- **AMBER-GB barrier atlas** (CC BY 4.0, cite Jones et al. 2019): 21,913 weirs, sluices and dams across Great Britain, with a measured height on most (to 10 cm; a few millimetres reads as unknown). The stop says "About 1.7 m high."

Both put points on the watercourse, so like OSM locks they count on a route only within 60 m (`ON_WATER_SOURCES` in `along.ts`; the EA asset register is one too). The atlas re-publishes EA and SEPA records, so weirs from different sources within 40 m merge, keeping the one with a name or height (grid-bucketed in `build.ts`).

About three quarters of the weirs on a navigation are a lock's own weir and sluices (Thames: 79 of 103 within 300 m of a lock). Listing them would bury the stop list, and the lock is already the portage, so `routePlan` folds a weir within 300 m (`WEIR_AT_LOCK_M`) of a lock or portage into it. Weirs on their own (Ditchford Weir, 1.7 m) stay stops.

## Coverage (2026-10-16)

`waterwayCoverage(links, features)` (`packages/waterways/src/waterway-coverage.ts`) scores every waterway, computed from the data and never typed in:
- **A waterway** is the named links that touch and share a name. A lone short link of another name between two pieces of one (a lock chamber) joins it, so the K&A isn't split at every lock; a stretch of another waterway doesn't. Unnamed water isn't scored, nor rivers under 10 km or canals and navigations under 1 km.
- **Kind** is by most of its length (canal, navigation = `boat=yes`, river). The Thames has lock cuts tagged canal; it is a navigation.
- **Counts:** each feature goes to the scored waterway it's on (snapped within its own reach, `nearOf`): locks and how many have a portage side, weirs, places to get in and out (access, slipways, portages), crew access, facilities, and which sources said so.
- **Level:** *good* has at least one place to get in and out per 10 km, crew access or facilities, and every lock's portage side known; *thin* has nothing but the line; *some* is between. Nationally (2026-10-16): 1,881 waterways, 9 good, 1,179 some, 693 thin. Nothing with locks can be good yet: no source records portage sides.

The server works coverage out on first ask (about half a second) and keeps it (`loadCoverage` in `national.ts`), so nothing extra is published. It's served as `/plan/data/{version}/coverage` (the rows, 60 KB gzipped) and `…/coverage-lines` (the scored water by level, 150 m simplification, 0.6 MB gzipped). On `/plan`, the **COVERAGE** switch colours the water green, amber or red with a legend; **`/plan/gaps`** lists every waterway with its counts (portage sides and missing access in red), filters by level and kind, a name search, and a link that opens it in the planner.

## Places search

The GO TO list is a typeahead. The index is built from OSM place nodes (city, town, village, hamlet) within 2 km of the network, plus the name of every lock and weir in the data: 24,604 places. It's one file loaded when the search box first gets focus and searched in the browser: whole-name prefixes first, then a word in the name, then bigger places, then nearer ones.

## The map

The browser never loads the whole network. Zoomed out (below zoom 9) it draws an overview: canals, navigations and rivers longer than 2 km, simplified to 250 m (about 300 KB gzipped). Zoomed in, it loads each 0.5° area on screen, simplified to 10 m (tens of KB each). Both come from `/plan/data/{version}/…`, cached for good under the live version.

## Phases

| Phase | What | Done when |
|---|---|---|
| **W1 Network** ✅ | Geofabrik extract, national network, server routing, check routes | All check routes pass |
| **W2 Planner** ✅ | Planner on `plan.route`, map by area, places typeahead | DW E2E passes on the national data |
| **W3 England** 🚧 | CRT national ✅ (1,722 locks, 1,108 weirs, 7,688 towpath access points…), EA Thames ✅ (45 locks), EA asset register ✅ (2,841 weirs, 149 slipways), EA uMap ✅ (55 Nene locks, water points, Elsan, weir warnings; current notices on five Anglian rivers), OSM lock chambers filling gaps ✅ (Great Ouse, Medway…), OSM lock-gate pairs where no chamber is drawn ✅ (2026-10-18: Medway 6 → 9 of about 10 locks), OSM public slipways and canoe put-ins filling access gaps ✅ (2026-10-19, `osmAccess`: within 60 m of the network and no authority access point, slipway or portage within 100 m; private, customers-only and closed ones left out; 2,191 of 2,284 fill a gap; Wye 0 → 19 places to get in, Tay 0 → 16, Severn 15 → 26; "good" waterways 117 → 396 km, "thin" 6,782 → 5,813 km), OSM public toilets and drinking water as facilities ✅ (2026-10-19, `osmFacilities`: within 100 m of the network and none of ours with the same facility within 100 m; customers-only, private and `drinking_water=no` left out; car parks deliberately not used; 8,625 fill a gap, on a route only within 60 m like all OSM points: Devizes → Westminster gains 15 beside its 45); to do: the Ancholme's two locks and Mutford Lock on the Broads, which nobody lists, not even OSM (map them in OSM or add them as OpenPortage contributions) | England coverage report |
| **W4 Scotland, Ireland** 🚧 | Scottish Canals ✅ (91 locks, 57 weirs, 66 landings), Waterways Ireland ✅ (182 locks, 10 carries, put-ins, facilities, warnings), SEPA obstacles ✅ (1,606 weirs, 2,456 waterfalls), AMBER-GB barrier atlas ✅ (21,913 weirs with heights, GB-wide), IFI National Barriers Programme ✅ (Republic of Ireland: 2,663 weirs, sluices and dams, 561 waterfalls; only those types are fetched, most of IFI's 42,000 records are culverts), river levels ✅ (live conditions) | Coverage report per nation |
| **W5 Pipeline** ✅ | Weekly refresh PR ✅ with its own role, staged last good copies and source health ✅, weekly discovery digest ✅; not built (not needed yet): raw snapshots with change detection | A scheduled run opens a PR with a correct summary |
| **W6 Coverage** 🚧 | Coverage map ✅ (COVERAGE switch), `/plan/gaps` ✅, OpenPortage contributions ✅ (see `river-planner.md`, "P1 as built"), "Most needed" locks ✅ (#481), portage paths mapped in OpenStreetMap as landings ✅ (2026-10-19: ways tagged `portage=*` keep their ends in the extract; pieces meeting end to end are joined and the outer ends are the landings; under 40 m is steps to a landing stage and dropped; published as `osm-portages.json` (ODbL), loaded as `ds.portages` beside paddlers' contributions, shown "Mapped in OpenStreetMap · ODbL" with no flag or delete, never in the CC0 dump; a carry round a lock flight covers every lock within half its length of its middle. 137 pieces → 32 portages, 21 of 40 m or more; 27 of the Caledonian's 29 locks), waterways ranked by how often they're planned ✅ (2026-10-18: each saved plan's demand record keeps its route sampled about every km, 4 dp, ≤400 points; `waterwayCoverage` counts the plans whose samples fall within 50 m of each waterway; the gaps table sorts by plans, then length, and shows a Plans column; counts only, never whose); to do: a weekly OpenPortage dump to a public repo (needs the owner's OK to create the repo) | Gaps page lists real holes, ranked |
