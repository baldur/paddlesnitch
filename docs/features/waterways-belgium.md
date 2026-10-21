# Feature spec: River planner data for Belgium

**Status:** 🚧 B1 built 2026-10-21 (network, places and check routes, from OSM only), on the same defaults as the Netherlands ([`waterways-netherlands.md`](waterways-netherlands.md)): one dataset, no ditches, open data only. The owner asked to start on Belgium on 2026-10-21.

## What's different from the Netherlands

- **Two regions, two sets of sources.** Flanders publishes most of its data under the Flemish Open Data licence (*Vlaamse Open Data licentie*, free reuse with attribution). Wallonia's waterway data is less clearly open.
- **Wallonia's rivers are where people paddle.** The Lesse, Ourthe, Amblève and Semois are classic kayak runs, with rental fleets. **Kayaking is restricted by flow**: the Walloon public service (SPW) opens and closes each river stretch from gauge readings, and publishes the status daily.
- **Boat lifts.** Belgian canals climb by inclined planes and lifts (Ronquières, Strépy-Thieu, the historic lifts on the Canal du Centre). OSM tags them `waterway=boat_lift`, which the extractor didn't read, so the Brussels–Charleroi canal broke at Ronquières and routed 298 km round Belgium. They're now part of the network, and each is listed as a lock: you carry round it. This also fixes the Falkirk Wheel and the Anderton Boat Lift in the UK at the next refresh.

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network, places | OSM via Geofabrik `belgium-latest.osm.pbf` | ODbL | ✅ B1 |
| Flemish waterways | De Vlaamse Waterweg: RIS-index (fairway axis, nodes) WFS/WMTS | Free reuse (model licence) | No open lock dataset found; the navigation-aids list isn't public. OSM locks fill in |
| Walloon kayak stretches | `kayak.spw.wallonie.be/rest/services/troncons/`: 21 stretches (Lesse, Ourthe, Amblève, Semois, Sûre, Our, Salm, Viroin…) with names in four languages, descriptions, the controlling gauge and its flow limits, and a navigation-allowed flag | **Reuse terms not found** (the legal page is a template) | Keyless JSON. The flag fields (`navaut`, `troope`, `mesnec`) must be decoded from the site's own script before showing "open" or "closed"; a wrong "open" could put someone on a closed river |
| Water levels, Flanders | waterinfo.vlaanderen.be (VMM/DVW, KiWIS) | CC BY 4.0 per one catalogue | Keyless for light use; a 2022 report says automated use needs a token (emailed), which breaks the keyless rule. Verify first |
| Aerial photos, Flanders | Informatie Vlaanderen orthophoto mosaic (WMTS) | Flemish Open Data licence v1.2 | Free, no registration; likely printable like PDOK's. Check the licence text for print and commercial use |
| Tides | The Scheldt is tidal to Ghent. Rijkswaterstaat's Bath and Hansweert gauges already cover the Westerschelde | — | Antwerp and the Zeeschelde would need a Flemish source |

## Plan

| Phase | What | Done when |
|---|---|---|
| **B1** Network ✅ | Belgium extract in the one dataset; boat lifts in the network; check routes Houyet → Anseremme (Lesse, 17.1 km), Ghent → Bruges (36.6 km), Brussels → Charleroi (66.4 km, 11 locks including Ronquières) | Check routes pass ✅ |
| **B2** Walloon kayak status 🚧 | Linked ✅ 2026-10-21: a plan on one of SPW's 13 regulated rivers (Lesse, Ourthe and its branches, Amblève, Semois, Sûre, Our, Salm, Viroin, Aisne, Houille, Vierre) says kayaking there is allowed only at suitable flows and links to kayak.spw.wallonie.be (`regulatedKayakRivers`, French articles and accents ignored; canals and side streams don't match). No SPW data is reused, only their river names and a link. To do, if the reuse terms allow: decode and show each stretch's status on the plan, with its gauge and limits | A Lesse plan says whether the Lesse is open today |
| **B3** Flanders 🚧 | Flemish aerial photos on screen ✅ 2026-10-21: Digitaal Vlaanderen's orthophoto mosaic (WMTS `omwrgbmrvl`, `GoogleMapsVL`, to zoom 21) goes **over** Esri on the satellite view when the map is centred near Flanders (`nearFlanders`). Unlike PDOK's tiles, they're transparent outside Flanders (a 400 beyond the grid's limits), so an overlay works and Wallonia keeps Esri. Privacy page names Digitaal Vlaanderen. In print ✅ 2026-10-21: every lock stop in Flanders gets Digitaal Vlaanderen's photo behind its drawing (WMS layer `Ortho`, exactly the drawing's extent; `printablePhotos` picks the Kadaster or Digitaal Vlaanderen by a rough Flanders outline along the language border, so Wallonia stays photo-free rather than blank), credited in the footer. To do: DVW waterways, waterinfo levels (if keyless) | — |

## Questions for the owner

1. The Walloon kayak status is the most useful thing for Belgian paddlers, but its reuse terms aren't published. Ask SPW (a short email), or show it only as a link to their site?
