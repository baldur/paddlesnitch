# Feature spec: River planner data for the Netherlands

**Status:** 🚧 N1 built 2026-10-20 (network, places and check routes, from OSM only), on the defaults recommended below while the owner's answers are pending: one dataset growing country by country, no ditches, OSM and CC0 only (no CC BY-SA, no outreach yet). The first step into Europe after the UK and Ireland ([`waterways-uk-ireland.md`](waterways-uk-ireland.md)), using the same pipeline, network and planner. Sources were checked by desk research on 2026-10-20. Each still needs its endpoint and licence confirmed when its job is written, as was done for the UK.

## Why the Netherlands first

- **Dense, well-mapped water.** OpenStreetMap's Dutch network is among the most complete anywhere, and canoe routes are mapped as `route=canoe` relations with portages as members ([OSM wiki: route=canoe](https://wiki.openstreetmap.org/wiki/Tag:route=canoe); the [recreational waterway project](https://wiki.openstreetmap.org/wiki/WikiProject_Europe/E-waterway_network/Recreational) lists networks such as Kanonetwerk De Rotte and Midden-Delfland).
- **Open government data, often CC0.** The national register ([data.overheid.nl](https://data.overheid.nl)) and PDOK serve national layers with clear licences, mostly keyless.
- **Printable aerial photos.** The Kadaster's 8 cm aerial photography is CC BY 4.0 ([2026 RGB](https://data.overheid.nl/dataset/77581-luchtfoto-beeldmateriaal-2026-5cm---8cm-rgb-open-data)). Unlike Esri, it can be stored and printed, which solves the printed-map problem the UK still has.

## What's different from the UK

- **Locks matter less to a canoe, and carries matter more.** Most Dutch paddling is on polder water, where the obstacles are weirs (*stuwen*), pumping stations (*gemalen*), dams and low culverts. Paddle routes use *overdraagplaatsen* (carry points) and *kanohellingen* (canoe ramps), not big-ship locks.
- **Bridges** are mostly irrelevant to a canoe. Lock and bridge opening times (EuRIS) matter to motor boats, not us, so they're skipped.
- **Tides:** the Wadden Sea and Zeeland are tidal. Rijkswaterstaat publishes astronomical predictions itself, so no harmonic fit of our own is needed.
- **Language:** the interface stays English. Names stay Dutch (Sluis Weurt, not "Weurt Lock"), and the places search needs Dutch diacritics and articles ('s-Hertogenbosch).

## Sources (to confirm per job)

| What | Source | Licence | Notes |
|---|---|---|---|
| Network | OSM via Geofabrik `netherlands-latest.osm.pbf` (~1.4 GB), same `osm_extract.py` | ODbL | Ditches (`waterway=ditch/drain`) are everywhere: keep the network to rivers, canals and anything in a `route=canoe` relation, or the router will send people down field drains |
| Canoe routes and portages | OSM `route=canoe` relations, `canoe=portage` segments, portage ways | ODbL | The core of the Dutch planner. Needs the extractor to read relations, which it doesn't today |
| National locks | Rijkswaterstaat FIS/VNDS lock layer (`geo.rijkswaterstaat.nl`, fis_vnds) ([register](https://data.overheid.nl/en/dataset/49337-vaarweginformatie-sluizen)) | CC0 | Big-ship waterways only. Provincial and water-board locks come from OSM |
| Weirs, pumping stations, dams | "Waterschappen Kunstwerken IMWA", all water boards in one GeoPackage via PDOK ([register](https://data.overheid.nl/en/dataset/54478-waterschappen-keringen-imwa) family) | **CC BY-SA 4.0** | Share-alike: keep it in its own published file like the OSM layer, and never in the CC0 contributions. Not every board delivers yet. Some boards also publish CC0 copies (e.g. [Drents Overijsselse Delta "Stuw"](https://data.overheid.nl/en/dataset/stuw-)) |
| Recreational network | Rijkswaterstaat BRTN ([register](https://data.overheid.nl/en/dataset/40881-nwp-basisrecreatietoervaartnetwerk)) | CC0 | Which water is a recreational route. "Indicative, no legal status" |
| Provincial canoe routes | e.g. Provincie Utrecht *Kanoroutes* ([georegister](https://nationaalgeoregister.nl/geonetwork/srv/metadata/adc07713-1cf8-44f2-a8a7-5f084aada9a2)) | Public domain | Province by province; check where OSM is thinner |
| Water levels | Rijkswaterstaat Waterinfo / DDL web services ([open data](https://www.rijkswaterstaat.nl/zakelijk/open-data)) | Open, attribution usually not required | Keyless per third-party clients; confirm endpoints and rate limits. Live, like the UK gauges |
| Tide predictions | Rijkswaterstaat DDL (astronomical tide) | Open | Wadden and Zeeland only |
| Aerial photos | Kadaster/PDOK *Luchtfoto Beeldmateriaal* WMTS, 8 cm | CC BY 4.0 (check each year's layer; 2014 was non-commercial) | On screen **and** printable. Credit "Beeldmateriaal.nl / Kadaster" |
| Places | OSM `place=*` | ODbL | As for the UK |

## Plan

| Phase | What | Done when |
|---|---|---|
| **N0** Decide | Owner answers the questions below | — |
| **N1** Network ✅ | Geofabrik Netherlands extract into the same dataset (the build reads every extract under `.cache/waterways/osm/`; elements in two are kept once), same network tags (no ditches), check routes Amsterdam → Utrecht (45.5 km), Rotterdam → Dordrecht (22.1 km), De Rotte (15 km, 1 lock); Dutch places in the search; map's first view widened | Check routes pass ✅ |
| **N2** Canoe routes 🚧 | Extractor reads `route=canoe` relations ✅ 2026-10-21: member ways get our `canoe_route` tag (the route's name); they count as paddleable unless tagged `canoe=no` (182 km of untagged route water moves from "unknown" to "paddleable"), and streams, ditches and drains join the network only where a route uses them (10 ways). 297 Dutch routes. On the two routes checked (Kaag-Braassem, De Rotte) the shortest route already followed them, so the effect today is small: it matters where unmarked water competes. Shown ✅ 2026-10-21: links carry `canoeRoute`, plans list the routes they follow for 500 m or more (`canoeRoutes`, "On Kanoroute Kaag-Braassem, a marked canoe route." under the summary and on the print header). To do: portage members as landings | A route along a mapped canoe network follows it and lists its carries |
| **N3** Structures 🚧 | RWS locks (CC0) ✅ 2026-10-20: `rws-fis` job, the WFS lock outlines (`sluis_v`, 383, 373 in the Netherlands, placed at each outline's middle; the map service's point layer is mostly German/Belgian EuRIS locks and lacks Weurt or IJmuiden) plus the 494 trailer slipways (CC0); OSM chambers fill gaps under the UK gap rule. Amsterdam → Utrecht now lists its 10 locks (canal ring, Driemond, Nigtevecht, Breukelen, Vechtsluis, Weerdsluis), De Rotte its 2 *verlaten*. To do: water-board weirs/pumping stations (CC BY-SA, own file; owner's answer pending) | Coverage map for the Netherlands |
| **N4** Live 🚧 | Water levels ✅ 2026-10-21 (Rijkswaterstaat DDL 2.0, keyless: the catalogue gives 707 locations measuring WATHTE; one `OphalenLaatsteWaarnemingen` call for all of them every 15 minutes, ~4 MB / ~2 s, keeps no route leaving the server; the service mixes in archive series back to the 1980s, so only the newest reading under 6 hours old counts, ~316 stations; shown as m NAP, no usual range). To do: tides (RWS astronomical predictions) | Conditions panel works on a Dutch plan |
| **N5** Imagery ✅ | On screen ✅ 2026-10-21: the satellite view uses the Kadaster's 8 cm aerial photos (PDOK WMTS `Actueel_orthoHR`, CC BY 4.0, to zoom 21) when the map is centred in the Netherlands (`inNetherlands`, a rough border outline), Esri elsewhere: PDOK's tiles are white outside the Netherlands, so they replace Esri rather than overlay it. Privacy page names PDOK. In print ✅ 2026-10-21: every lock stop in the Netherlands gets the Kadaster's photo of 120 m round it (or of the carry, where paddlers gave landings) behind the drawing, from PDOK WMS for exactly the drawing's extent (`aerialPhotoUrl`, square on the ground), credited in the footer. Elsewhere the drawing stays as it was (landings only, no photo: Esri may not be printed) | Printed sheet has a photo map per carry ✅ |

Cost: the same weekly workflow and bucket. The extra network adds to the server's in-memory `network.json`; measure it at N1 against the server Lambda's memory before deciding question 1.

## Tides (2026-10-21)

16 Dutch gauges (`RWS_TIDE_GAUGES` in `tide.ts`) are fitted with our own harmonic model, the same one as the Thames, from a year of Rijkswaterstaat's measured heights (`download-rws-tides.ts`, then `pnpm waterways:tides`). They're held to the same display gate (median ≤ 15 min, 95% within 45 min, against measured high waters).

- **Five pass** and ship in `tides.json`: Hansweert, Bath, Stavenisse, Maassluis, West-Terschelling.
- **Eleven don't** (Vlissingen, Terneuzen, Hoek van Holland, Rotterdam, Dordrecht, Scheveningen, IJmuiden, Den Helder, Harlingen, Lauwersoog, Delfzijl). They're left out of the file, and plans there say predictions aren't ready.
- **Why:** our curve is within about 10 cm rms of Rijkswaterstaat's own astronomical prediction, but the Dutch tide's flat or double high water makes the *time* of high water sensitive to small height errors. We're 13–30 min off RWS's own timings, and fitting to RWS's clean astronomical series instead of measurements doesn't fix it, so it's the model, not noise.
- **Done next (2026-10-21): Rijkswaterstaat's own predictions.** `fetch-rws-tide-extremes.ts` fetches their computed high and low waters (`GETETBRKD2`, astronomical) for all 16 gauges, about 14 months ahead (published to the end of the following year), in the weekly refresh. The build publishes them with the version as `tides-nl` (~350 KB raw), served at `/plan/data/{version}/tides-nl`. The planner and print sheet load them only when a plan meets tidal water in or near the Netherlands (`reachesDutchTide`, `useOfficialTides`). Where they're loaded, they replace our Dutch fits in `tideWindow`, marked "Rijkswaterstaat"; offline, or on a version without them, our five passing fits remain. No route is ever sent: the file is the same for everyone. A failed fetch doesn't fail the refresh: it's capped at 10 minutes, and the build then carries forward the live version's `tides-nl` while every gauge still reaches 30 days ahead (`reachesAhead`), so a slow week at Rijkswaterstaat doesn't drop the predictions.

## Measured (2026-10-20, Geofabrik extract of that day)

A local experiment, nothing published.

| | UK and Ireland (live) | Netherlands |
|---|---|---|
| Network ways (river, canal, flowline, fairway) | 69,940 | 23,585 |
| Links / km of water | 80,557 / 63,196 km | 31,808 / 16,782 km |
| `network.json` raw / gzipped | 36.3 / 10.2 MB | 7.1 / 1.7 MB |
| Server memory for the links (heap growth) | ~264 MB | ~28 MB |

- **Canoe routes:** 335 `route=canoe` relations with 1,426 member ways. By length they run on canals (701 km), rivers (123 km) and fairways (19 km). Ditches, drains and streams come to about **4 km**, so the existing network (no ditches) already carries over 99% of the mapped Dutch canoe routes. Their 163 portage members are short marked carry segments.
- **Memory:** adding the Netherlands to the in-memory network costs about a tenth of what the UK and Ireland already use; the server Lambda has 1,024 MB. (Live peak use wasn't checked: the AWS sign-in had expired.)

So, on the numbers: **one dataset** that grows country by country is fine for the Netherlands, and **no ditches** loses almost nothing. Both are recommendations for questions 1 and 2 below; the owner decides.

## Owner decisions (2026-10-21)

- **CC BY-SA water-board data: yes**, under the licence-layer rules (own published file, never in the CC0 contributions). Built: see "Water boards" below.
- **Watersportverbond: not yet.**
- **Questions 1 and 2:** no answer given. Building continued on the recommended defaults (one dataset, no ditches).
- **OpenPortage public repo** (UK question): later. First get contributions flowing in the app.

## Water boards (2026-10-21)

The national "Waterschappen Kunstwerken IMWA" set via PDOK WFS (CC BY-SA 4.0), source `nl-waterboards`. It covers weirs (`stuw`), bed drops (`bodemval`), fixed dams (`vastedam`, as hazards), pumping stations (`gemaal`, as hazards) and the boards' own small locks (`sluis`): 133,478 in all. Culverts, bridges and siphons aren't read.
- **Reading it:** PDOK serves 1,000 a page and no page past 50,000, so it's read in four quadrants. Pages can come back short with more to come, so paging runs to each quadrant's `numberMatched`.
- **Side ditches:** most structures are on ditches beside our water (a dam at a ditch's mouth, a pumping station's outfall). They count only **within 10 m** of our network (`WATERBOARD_NEAR_M`): the boards' own locks sit within 5 m, while side-ditch dams sit 10–60 m off. That keeps 3,858.
- **Licence layer:** published as `sa-features.json` (~0.9 MB raw), never merged into the core features. A board lock or weir that one of ours already lists nearby is dropped as the same one.
- **Found on the way:** `snap` ignored a small `maxM`, fixed in #542, which this builds on.

## Questions for the owner (2026-10-20, as asked)

1. **One dataset or one per country?** One "Europe" network keeps routing simple but grows memory with every country; per-country datasets keep each small and would need a country pick (or a guess from the map view).
2. **Ditches:** route only on mapped canoe routes plus rivers and canals (safe, misses some polder paddling), or on all small water (finds more, but routes through field drains)? I'd start safe.
3. **CC BY-SA** water-board data is fine under the same licence-layer rules as OSM. Agreed?
4. **Partners:** Watersportverbond (the Dutch paddling federation) keeps canoe-route information. Approach them, as with Paddle UK, or stay with open data only?
