# Feature design records

Shipped specs are kept here as design records. **Each doc's own status line is the source of truth for its status**; this table is an index (moved from the root `CLAUDE.md`). Current behaviour is in the `CLAUDE.md` for the area.

Shipped specs are kept in `docs/features/` as design records. **Each doc's own status line is the source of truth for its status**; this table is an index. The sections below describe *current* behaviour.

| Doc | Status | What it covers |
|---|---|---|
| [`courses-and-entries.md`](courses-and-entries.md) | ✅ 2026-05 | Course catalogue, entries, boat class + crew, pace, dates |
| [`visibility-clubs-tos.md`](visibility-clubs-tos.md) | ✅ 2026-06 | Visibility, clubs (now groups), invitational trials, versioned ToS |
| [`groups-and-creation-gating.md`](groups-and-creation-gating.md) | ✅ 2026-06 | club→group, creation gated to group admins, member-gated submission, joining |
| [`platform-monorepo.md`](platform-monorepo.md) | ✅ superseded | The original two-app split; replaced by `unified-app-and-api.md` |
| [`unified-app-and-api.md`](unified-app-and-api.md) | ✅ 2026-09 | One Next app + the shared tRPC API |
| [`paddle-analysis.md`](paddle-analysis.md) | ✅ 2026-08 | The analysis engine and its design decisions |
| [`personable-insights.md`](personable-insights.md) | ✅ 2026-08 | History-aware summary: aggregates, athlete profile, retrieval. **The model switch to Haiku/Nova was NOT made; prod runs Mixtral** (`LLM_MODEL` in `infra/lib/att-stack.ts`) |
| [`similar-sections-compare.md`](similar-sections-compare.md) | ✅ 2026-08 | Compare a section across your paddles |
| [`weather-and-river-conditions.md`](weather-and-river-conditions.md) | ✅ | Wind + river flow for a paddle |
| [`single-app-shell.md`](single-app-shell.md) | ✅ 2026-08 | Shared header/shell, one dark theme |
| [`share-image-strava.md`](share-image-strava.md) | ✅ P1+P2 (Strava helper removed 2026-11) | Share card image; the Strava helper went with Strava; P3 dropped |
| [`profile-routes.md`](profile-routes.md) | ✅ | Platform-level profile/account routes (account is now `/account`) |
| [`strava-auto-import.md`](strava-auto-import.md) | 🗑️ removed 2026-11-01 | Strava webhook auto-import; Strava removed from the platform (history only) |
| [`device-uplink.md`](device-uplink.md) + [`device-data.md`](device-data.md) | ✅ 2026-09 | Tracker pairing, chunked upload, what the data contains |
| [`device-ota-and-auth.md`](device-ota-and-auth.md) | ✅ built; rollback seen on hardware | Firmware OTA; every merge to `main` promotes to beta, then the flip to stable |
| [`device-screen-map.md`](device-screen-map.md) | 📋 reference | Tracker screens and the web pages they lead to |
| [`qr-onboarding.md`](qr-onboarding.md) | Phase 1 built | Scan to join WiFi, scan to add a tracker |
| [`waterways-netherlands.md`](waterways-netherlands.md) | 🚧 N1–N4 + water boards 2026-10-21 | Netherlands: N1 network (OSM, same dataset) and Rijkswaterstaat locks/slipways (`rws-fis`, CC0) built; phases N2–N5; four owner questions |
| [`waterways-belgium.md`](waterways-belgium.md) | 🚧 B1 built 2026-10-21 | Belgium: OSM network in the one dataset; boat lifts (`waterway=boat_lift`) in the network and as locks; Walloon kayak status (B2) waits on reuse terms |
| [`waterways-france.md`](waterways-france.md) | 🚧 F1 built 2026-10-21 | France: OSM network in the one dataset (doubles it to ~185,000 km; server Lambda to 2,048 MB); small water tagged `boat`/`canoe`=yes joins the network; F2 ROE weirs and dams (82,000, Licence Ouverte) with drop + canoe pass; F3 IGN photos on screen (replacing Esri when centred in France, `inFrance`) and in print; Hub'Eau levels blocked from dev (TLS reset) |
| [`waterways-germany.md`](waterways-germany.md) | 🚧 G1 + G2 2026-10-22 | Germany: OSM network (+57,000 km, 242,410 km in all; fits 2 GB with the streamed network, #588); PEGELONLINE live levels (DL-DE Zero, 786 federal gauges in one call, the WSV's own low/normal/high state; ß matches ss); G3 AMBER weirs |
| [`waterways-austria-switzerland.md`](waterways-austria-switzerland.md) | ✅ A1–A4 2026-10-23 | Austria and Switzerland: OSM network (+17,500 km), AMBER weirs, BAFU live Swiss levels (m a.s.l., high past the first flood threshold, LV95→WGS84), swisstopo (screen + print) and basemap.at (screen) photos replacing Esri by centre; Austrian levels need a key (parked) |
| [`waterways-denmark-sweden.md`](waterways-denmark-sweden.md) | 🚧 D1 built 2026-10-23 | Denmark and Sweden: OSM network (+68,600 km, 328,817 km in all; lake routing works; server peak 1,430 MB); next AMBER weirs, SMHI flows (bulk) and Danish levels (per route); no keyless aerial photos |
| [`sitemap.md`](sitemap.md) | ✅ current map | Every route, as of the 2026-09 navigation clean-up |
| [`security-audit-2026-09.md`](security-audit-2026-09.md) | 🔍 audit, 2026-09-29 | Security, privacy, resilience (firmware, web, live AWS). Fixes: PRs #303–#320. The rest: 15 decisions with trade-offs. Read "Read this first" before handing trackers to testers |
| [`behavioural-analytics.md`](behavioural-analytics.md) | 🚧 spec, not built | Consent-gated struggle signals |
| [`observability.md`](observability.md) | 📝 spec, decisions made 2026-10-25 | Dashboards + error alerts for web, Android, iOS and trackers: `paddlesnitch-health` (replaces `-app`), `paddlesnitch-api` (replaces `-performance`, adds email), firmware; `-mobile` when an app ships (stay within 3 free dashboards). Platform is a filter, not a dashboard. Close to zero tolerance: alarms on the first server error, failed action or crash, after a clean-up; `console.error` = we broke something, expected failures `console.warn`. Daily digest; own crash report on next launch. Phases O1–O3, server-only until the apps adopt the contract |
| [`river-planner.md`](river-planner.md) | 🚧 P0 + P1 built 2026-10-11 | New **Plan** section (`/plan`): click start and finish on a waterway → portages, access and crew points with ETAs, printable route sheet. P0: `@paddlesnitch/waterways` + ingest (OSM network, CRT, EA Thames) + Devizes→Westminster dataset (201.3 km, 77 locks) and coverage report. P1: the `/plan` planner (two clicks, one-way/return, stop list with arrival times, unsaved plan in the URL, saved plans under `users/{id}/plans/`; SHARE gives a plan an unlisted link `/plan/shared/{shareId}` and lists it to your buddies). CC0 contributions, race-agnostic, tides from our own fit of EA gauge data |
| [`release-testing.md`](release-testing.md) | ✅ in use 2026-10 | Firmware release checklist: bench walk with `firmware/tools/bench.sh`, phone steps, after-merge update check, rollback; plan for beta channel + hardware in CI |
| [`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md) | 📋 spec, not built | Recordings home by phone/browser over Bluetooth, compression first, game-style setup |
| [`mobile-apps.md`](mobile-apps.md) | 🚧 C1 built | Native Android + iPhone apps sharing a contract, not code: generated API schema, golden fixtures, design tokens in `mobile/contract/`; phone as tracker; server changes. Replaces the Expo plan. **C1:** schemas in `packages/api/src/contract.ts` (type-checked against the router, not runtime `.output()`), `pnpm mobile:contract` regenerates `mobile/contract/{api,tokens,format}`, `mobile-contract.test.ts` fails while stale |
| [`on-device-metrics.md`](on-device-metrics.md) | 🚧 phase 1 in progress | Live stroke rate and boat motion on the tracker and phones from ONE portable C recorder core (`recorder-core/`, also the server via WASM); devices log what they showed (`live_*` columns), raw data always uploaded and recomputed; streaming = batch |
| [`android-app.md`](android-app.md) | 🚧 P0 done, P1 started, P3 tracker setup built (awaiting hardware test) (`mobile/android`, CI `android.yml`, `/.well-known/assetlinks.json`) | The Android app: Kotlin + Compose, Android 10+, capability list, CompanionDeviceManager pairing, Google Play |
| [`ios-app.md`](ios-app.md) | 🚧 P0 + P1 built | The iPhone app: Swift + SwiftUI, iOS 17+, capability list + "This iPhone", While Using recording, AccessorySetupKit pairing, MapKit; build first (simulator + free Apple ID), App Store at P5 |
| [`buddies-and-compare.md`](buddies-and-compare.md) | ✅ 2026-10-11 | Mutual buddies who see each other's paddles; two paddles on one map to study the line |
| [`one-paddle.md`](one-paddle.md) | ✅ phases 1–4 built | One paddle whatever the source: tracker stroke rate through the paddle, automatic tracker paddles, boat motion on the paddle page, same-outing comparison |
| [`motion-only-paddles.md`](motion-only-paddles.md) | ✅ B built 2026-10-11 | A tracker recording whose GPS failed becomes a paddle without a map (no estimated distance) |
| [`performance.md`](performance.md) | 📋 proposal | Assemble once, always fresh: version-keyed derived values, views written on change, data in the first HTML, warm server; priced options (S3, DynamoDB, ElastiCache) and the Rust/WASM question |
