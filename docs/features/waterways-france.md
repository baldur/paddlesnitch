# Feature spec: River planner data for France

**Status:** 🚧 F1 built 2026-10-21 (owner: "start on France"): the France extract is in the one dataset and the three check routes pass. Same defaults as the Netherlands and Belgium: one dataset, no ditches, open data only.

## What's different

- **Size.** France has more navigable and paddleable water than the UK, Ireland, the Netherlands and Belgium together, and the Geofabrik extract is ~4.6 GB. The dataset's memory on the server Lambda (1,024 MB) needs measuring before France goes in; this may be where one dataset stops being enough (question 1 of the Netherlands plan).
- **Canoe touring rivers** (the Dordogne, Ardèche, Tarn, Vézère, Loire…) with rental fleets and descents measured in days, plus the canals (Midi, Nivernais, Bourgogne).
- **VNF** (Voies navigables de France), the waterways authority, has historically reserved all rights to its data (OSM France discussions, 2011 and 2016), so locks come from OSM, which maps French canals well.

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network, places, locks | OSM via Geofabrik `france-latest.osm.pbf` | ODbL | Locks, slipways and canoe routes from OSM, as elsewhere |
| Weirs, dams, canoe passes | **ROE**, the national register of river obstacles (Sandre/OFB), WFS `services.sandre.eaufrance.fr/geo/obs`, layer `ObstEcoul_FXX` (mainland) | "Accès libre, no conditions apply" in the WFS; Sandre's reference data are published under the Licence Ouverte (to confirm in writing) | 119,384 obstacles with type (barrage, seuil…), state (incl. demolished), name, and **navigation passes** (`LbTypeDispFranchNavig*`), which can record a canoe pass beside a weir |
| Water levels | Hub'Eau hydrométrie (`hubeau.eaufrance.fr/api/v2/hydrometrie`), keyless, Licence Ouverte | Licence Ouverte | **Reset the connection from here on 2026-10-21** (curl and Node): retry before building |
| Aerial photos | IGN BD ORTHO via the Géoplateforme WMTS (`data.geopf.fr/wmts`, layer `ORTHOIMAGERY.ORTHOPHOTOS`, Web Mercator `PM`) | Licence Ouverte v2 | ✅ answers keyless; printable like PDOK's and Flanders' |
| Tides | SHOM | Licensed; needs an account | Out under the keyless rule. Tidal estuaries (Seine, Loire, Gironde) get "predictions aren't ready" |

## Plan

| Phase | What | Done when |
|---|---|---|
| **F1** Network ✅ | Geofabrik France extract; check routes Toulouse → Castelnaudary (Canal du Midi, 62.9 km, 19 locks), La Roque-Gageac → Beynac (Dordogne, 14.2 km), Paris Pont d'Iéna → Pont d'Austerlitz (Seine, 6.4 km). **Measured:** France adds 107,163 links and 100,032 km (the dataset goes from ~85,000 to 184,873 km; `network.json` 96.8 MB raw). Server memory with France loaded is 918–956 MB RSS against 514–667 MB today, too close to the Lambda's 1,024 MB, so `ServerFn` goes to 2,048 MB (about double the Lambda cost per ms of a request; still pennies at today's traffic). The build needs `--max-old-space-size=8000`, and the refresh downloads and extracts one country at a time to fit the runner's disk. **Small water tagged open to boats** (`boat`/`canoe` = yes, designated or permissive on a stream, ditch or drain) now joins the network: 1.6 km of the Canal du Midi at the Seuil de Naurouze is mistagged `waterway=stream, boat=yes`, which broke the canal | Check routes pass ✅, memory fits ✅ (at 2,048 MB) |
| **F2** Obstacles | ROE weirs and dams (not demolished), canoe passes noted on the stop | A Dordogne or Loire plan lists its weirs, with "canoe pass" where there is one |
| **F3** Live and imagery | Hub'Eau levels (if reachable), IGN photos on screen and in print | — |
