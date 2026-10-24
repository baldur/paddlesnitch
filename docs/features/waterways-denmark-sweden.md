# Feature spec: River planner data for Denmark and Sweden

**Status:** 🚧 started 2026-10-23 (owner: "Denmark and Sweden"). Same defaults: one dataset, no ditches, open and keyless data only.

## What's different

- **Lakes.** Swedish paddling is largely lake systems (Dalsland, Glaskogen, the Göta and Kinda canals) and Danish touring the Gudenå through the Silkeborg lakes. OSM's water lines run through the lakes (flowlines, canoe routes), and the check routes across Lake Boren and the Silkeborg lakes route.
- **Size.** Sweden is the biggest addition yet: +68,600 km.

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network, places, locks, hire | OSM via Geofabrik `denmark-latest`, `sweden-latest` | ODbL | ✅ D1 |
| Swedish flows | **SMHI** hydrological observations, `opendata-download-hydroobs.smhi.se` parameter 2 (discharge, 15 min), `station-set/all/period/latest-hour` | CC BY 4.0 (SMHI open data) | Keyless, one call (~75 KB): 159–180 stations with readings. **No river name**: SMHI gives the catchment, and most stations sit on a tributary of it, so a catchment name hid them from their own route (#619's bug); they match by distance (300 m) instead. Discharge (m³/s), not level: gauges need a flow unit. Only 10 water-level stations (parameter 3) |
| Danish levels | **Miljøportalen VandA/H** (`vandah.miljoeportal.dk/api`), keyless | To check | Station list one call (4.5 MB); readings need a station id per call, so fetch only the gauges on a route (like the EA), not every station |
| Weirs, dams, sluices | AMBER Europe (`amber-eu`) | CC BY 4.0 | Denmark 1,595, Sweden 11,144 |
| Aerial photos | Dataforsyningen (DK), Lantmäteriet (SE) | Open, but both need a (free) key | Not keyless: Esri on screen, nothing printed |

## Plan

| Phase | What | Done when |
|---|---|---|
| **D1** Network ✅ | Both extracts: +46,091 links, +68,600 km (328,817 km in all; 305,887 places). Check routes Silkeborg → Ry (Gudenå through the lakes, 18.6 km, 1 lock), Borensberg → Motala (Göta kanal across Boren, 16.0 km, 2 locks), Kungsholmen → Slussen (Stockholm, 2.5 km). Server peak 1,430 MB (was 1,344 with the packed network, #611), loads in 0.8 s; ~350 MB headroom on 2 GB. Build peak 3.0 GB | Check routes pass ✅, memory fits ✅ |
| **D2** Weirs | AMBER Europe for Denmark and Sweden | A plan lists its weirs |
| **D3** Live | SMHI flows (bulk), Danish levels (per route); a flow unit on gauges | A Swedish plan shows a flow |
