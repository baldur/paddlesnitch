# Feature spec: River planner data for Germany

**Status:** 🚧 started 2026-10-22 (owner: "start on Germany"); G2 levels merged (#587), G1 network built and measured. Same defaults as the Netherlands, Belgium and France: one dataset, no ditches, open data only.

## What's different

- **Size, again.** Germany's Geofabrik extract is about 4.5 GB, and the server Lambda already holds France (918–956 MB with France on a 2,048 MB Lambda; a cold first route takes ~9 s). Germany has to be measured before it goes in (G1); if it doesn't fit, this is where the one dataset gets split by country.
- **The federal waterways** (Bundeswasserstraßen: the Rhine, Elbe, Danube, Mittellandkanal, the Berlin and Brandenburg lakes and canals) are run by the WSV, which publishes its gauges openly. Locks come from OSM, which maps German waterways well.
- **Canoe touring** on smaller rivers (the Altmühl, Lahn, Spreewald, the Mecklenburg lakes) with hire bases, which OSM's `amenity=boat_rental` already gives us (#570).

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network, places, locks, hire | OSM via Geofabrik `germany-latest.osm.pbf` | ODbL | As elsewhere |
| Water levels | **PEGELONLINE** (WSV), REST `pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true` | **DL-DE->Zero-2.0** (stated on its terms and web-service pages: commercial and non-commercial use, no conditions) | ✅ G2: 786 federal gauges in one keyless call (~750 KB, 0.7 s); the level "W" in cm on the gauge's own scale, and the WSV's own state against mean low and high water (`stateMnwMhw`), so no typical range is needed. 616 fresh on 2026-10-22, 372 with a state. River names in capitals ("UNTERE HAVEL-WASSERSTRASSE"): title-cased, and ß folds to ss when matching OSM's "Wasserstraße" |
| Weirs, dams, sluices | AMBER Europe atlas (`amber-eu`), Germany | CC BY 4.0 | 100,911 weirs, dams, sluices and bed sills (of 178,996 barriers): G3, counted only on the water like Belgium's |
| WSV infrastructure (locks with names, chambers) | WInD WFS (federal geodata terms, attribution) | GeoNutzV (attribution) | Not located yet in the catalogue; OSM locks first |
| Aerial photos | The states (Länder) publish their own; several are open (e.g. NRW, Berlin, Brandenburg, Bavaria) | Varies | Later, state by state, as Flanders was |
| Tides | BSH (North Sea, Elbe, Weser) | To check | Later |

## Plan

| Phase | What | Done when |
|---|---|---|
| **G1** Network ✅ | Geofabrik Germany extract. Check routes: Minden → Hannover (Mittellandkanal, 57.9 km, no locks), Weilburg → Limburg (Lahn, 35.8 km, 5 locks, 5 weirs), Berlin Oberbaumbrücke → Museumsinsel (Spree, 3.8 km). **Measured:** Germany adds 63,371 links and ~57,300 km (dataset 288,433 links, 242,410 km; `network.json` 121 MB raw); 260,464 places. Server peak memory with France and Germany: 1.62 GB with the old loader, **1.23 GB** with the network streamed one link per line (#588), about what France alone peaks at today, so the 2 GB Lambda stays. The refresh's time limit goes to 120 min. Needs #588 merged first | Check routes pass ✅, memory fits ✅ (with #588) |
| **G2** Live levels ✅ | PEGELONLINE gauges on a route, with the WSV's state | A plan on the Havel shows its gauge |
| **G3** Weirs ✅ | AMBER Europe (`amber-eu`) now reads Belgium and Germany: 104,061 barriers fetched (100,911 German weirs, dams, sluices and bed sills), counted only on the water (60 m); with the German network, core features rose from 74,757 to 110,714. The Lahn run (Weilburg → Limburg) lists its 5 weirs | A canoe-river plan lists its weirs ✅ |
