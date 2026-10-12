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
| Normalised | `waterways/normalised/{source}/latest.json` + `state.json` | One file per source, our schema, before merging |
| Published | `waterways/published/{version}/…` | The network for routing, area files for the map, features, places. Immutable; `version` is the build date plus a short hash |
| Live pointer | `packages/waterways/data/manifest.json` in git | The version the app serves, counts per nation and source, coverage summary |

Locally everything goes through `@paddlesnitch/core/storage`, so it lands under `.local-data/` in dev.

### Merging sources

The three licence layers stay as built (core, OSM, contributions) with one addition: non-commercial sources are a tagged slice of core. Two sources describing the same lock are matched by distance and name, as `build.ts` already does for CRT and EA. Precedence is per field: the authority wins on position and name; contributions win on portage side and landing.

### Scheduling

GitHub Actions, scheduled weekly (Sunday 02:17 UTC; off the hour, because runs on the hour get delayed or dropped):
- **refresh** (built: `.github/workflows/waterways-refresh.yml`, also runnable by hand): downloads the Geofabrik extract, runs `osm_extract.py`, `pnpm waterways:sources` and `pnpm waterways:national` (checks), then assumes the `att-github-waterways` role, publishes the version to `s3://paddlesnitch-data-prod/waterways/published/{version}/` and opens a PR setting `manifest.json`, with the build summary. A PR opened with `GITHUB_TOKEN` starts no `pull_request` runs, so the job dispatches `checks.yml` and `e2e.yml` on its branch. Merge to publish; the deploy then serves the new version.
  - **The role** (`infra/lib/att-stack.ts`) trusts only jobs in the `waterways-data` environment and can read and write only `waterways/*` in the data bucket; `deploy-trust.test.ts` holds it there. The workflow derives its ARN from the deploy role's (same account). GitHub creates the environment on the first run; restricting it to `main` under Settings → Environments is worth doing.
  - Raw snapshots under `waterways/raw/` expire after 90 days. Published versions are kept: the live one is named in git.
- **discover:** saved searches on data.gov.uk, data.gov.ie and OpenDataNI (CKAN) and ArcGIS Hub for lock, weir, slipway, portage, canoe, blueway and navigation. Anything not in the registry opens a `candidate-source` issue.
- **health:** a source that fails three runs in a row is marked `broken` and opens an issue.

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
| Devizes → Westminster | 201 km, 77 locks (found: 201.4 km, 77) | DW race |
| Lechlade → Teddington | 45 Thames locks (found: 199.6 km, 45; EA says 124 miles) | EA |
| Corpach → Clachnaharry (Caledonian Canal) | 29 locks (found: 94.1 km, 29; 60 miles) | Scottish Canals |
| Lanesborough → Athlone (Shannon, across Lough Ree) | connected through the lough | Waterways Ireland |
| Athlone → Banagher (Shannon) | connected | Waterways Ireland |

## Places search

The GO TO list is a typeahead. The index is built from OSM place nodes (city, town, village, hamlet) within 2 km of the network, plus the name of every lock and weir in the data: 24,604 places. It's one file loaded when the search box first gets focus and searched in the browser: whole-name prefixes first, then a word in the name, then bigger places, then nearer ones.

## The map

The browser never loads the whole network. Zoomed out (below zoom 9) it draws an overview: canals, navigations and rivers longer than 2 km, simplified to 250 m (about 300 KB gzipped). Zoomed in, it loads each 0.5° area on screen, simplified to 10 m (tens of KB each). Both come from `/plan/data/{version}/…`, cached for good under the live version.

## Phases

| Phase | What | Done when |
|---|---|---|
| **W1 Network** ✅ | Geofabrik extract, national network, server routing, check routes | All check routes pass |
| **W2 Planner** ✅ | Planner on `plan.route`, map by area, places typeahead | DW E2E passes on the national data |
| **W3 England** 🚧 | CRT national ✅ (1,722 locks, 1,108 weirs, 7,688 towpath access points…), EA Thames ✅ (45 locks); to do: other EA navigations, Broads, EA weirs (AIMS) | England coverage report |
| **W4 Scotland, Ireland** 🚧 | Scottish Canals ✅ (91 locks, 57 weirs, 66 landings), Waterways Ireland ✅ (182 locks, 10 carries, put-ins, facilities, warnings); to do: SEPA, AMBER-GB, IFI, OPW levels | Coverage report per nation |
| **W5 Pipeline** 🚧 | Weekly refresh PR ✅ with its own role; to do: raw snapshots to S3 with change detection, discovery, health | A scheduled run opens a PR with a correct summary |
| **W6 Coverage** | Coverage map, `/plan/gaps`, contribution prompts | Gaps page lists real holes, ranked |
