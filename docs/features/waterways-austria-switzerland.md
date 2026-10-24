# Feature spec: River planner data for Austria and Switzerland

**Status:** ✅ A1–A4 merged 2026-10-23 (#603–#606; owner: "Austria and Switzerland"). Austrian live levels parked (key needed). Same defaults as before: one dataset, no ditches, open and keyless data only.

## What's different

- **Mountain rivers.** Much of the paddling is white water (the Inn, Salzach, Enns, the Swiss Reuss and Rhine gorge), where OSM's network still routes but the planner's weirs and portages matter more than locks. The Danube (Wachau), the Rhine (Lake Constance to Basel), the Aare and the lakes are the touring water.
- **Size.** Both extracts are small next to France and Germany, but the overview is already 4.9 of its 5.5 MB limit (the build guard, `tooBigToServe`): it may need chunking like `coverage-lines`.

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network, places, locks, hire | OSM via Geofabrik `austria-latest`, `switzerland-latest` | ODbL | As elsewhere |
| Swiss water levels | **BAFU** hydrology, the map's GeoJSON `hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_pq.geojson` | Free use, commercial included, source recommended (BAFU terms of use 2020); current raw data at most every 10 min (BAFU general terms 2019) | ✅ 207 federal stations, 204 fresh on 2026-10-23: the level in m above sea level ('aod'), "high" only when the reading has reached BAFU's first flood threshold (`wl_1`, same unit; the map's level icons aren't danger levels and aren't used). Coordinates LV95 → WGS84 (swisstopo's approximate formulas). Fetched every 15 min, whole list, no route sent. The documented channel is LINDAS (linked data); this GeoJSON is the map's own and may change |
| Austrian water levels | Ministry WFS (CC BY 4.0) | CC BY 4.0 | Needs an API key: parked (keyless rule). Pegelalarm is commercial |
| Weirs, dams, sluices | AMBER Europe (`amber-eu`) | CC BY 4.0 | Austria 21,592, Switzerland 109,068 barriers (weirs, dams, sluices, bed sills), counted only on the water |
| Aerial photos | swisstopo SWISSIMAGE (WMTS `wmts.geo.admin.ch`, keyless; WMS for print) and basemap.at orthofoto (WMTS, CC BY 4.0) | Swiss OGD (credit swisstopo); CC BY 4.0 | Both answer keyless; transparency outside each country to check |

## Plan

| Phase | What | Done when |
|---|---|---|
| **A1** Network ✅ (#604) | Both extracts: +15,657 links, ~17,500 km (259,945 km in all). Check routes Melk → Krems (Danube, 35.0 km), through Bern (Aare, 4.1 km), Zürich → Rapperswil (28.4 km). Server peak 1,385 MB (was 1,231); the overview reached 5.2 MB, so it's now served in chunks (#607) | Check routes pass ✅, memory fits ✅ |
| **A2** Swiss levels ✅ | BAFU stations on a route | An Aare plan shows Bern's gauge |
| **A3** Weirs ✅ (#605) | AMBER Europe for Austria (21,592) and Switzerland (109,068) | A plan lists its weirs |
| **A4** Photos ✅ (#606) | swisstopo SWISSIMAGE replaces Esri when centred in Switzerland (it carries imagery past the border), and prints via its WMS; basemap.at replaces Esri when centred in Austria (white beyond it) and is on screen only (no WMS) | — |
