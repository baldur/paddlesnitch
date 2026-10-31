# UK and Ireland waterway data sources (research, 2026-10-12)

The inventory behind [`waterways-uk-ireland.md`](waterways-uk-ireland.md). Owner decisions made after it was written are recorded there, not here.

The UK and the island of Ireland can be covered at the level of **navigation structures** (locks, weirs, slipways, landings, facilities) using about a dozen open, keyless sources. Paddlesnitch already uses the two biggest of these, CRT and the EA. The others are Scottish Canals' OGL shapefiles, Waterways Ireland's ArcGIS layers, and national weir and barrier inventories for each jurisdiction. River levels are open everywhere except Wales (key required) and Northern Ireland (no API). No source anywhere records **portage detail**: which bank, how far the carry is, what the landing is like. OSM has 3 `canoe=portage` ways in all of Great Britain and none in Ireland. The one big paddler database, PaddlePoints, sits behind a membership wall and grants rights only to Paddle UK. So the inventory has two halves. A patchwork of authority data covers "where the structures are", and only paddlers can supply "how to get round them". That makes a CC0 contribution layer, effectively an "OpenPortage" dataset, the product's core asset rather than a side feature. The recommended organisation builds on P0 rather than replacing it. It has five parts:
- A public, schema-checked **source registry**, one file per dataset, filed by country and nation.
- **National pull jobs** per dataset, plus **locality jobs** for the long tail of per-river pages, PDFs and council layers.
- An S3 **raw → normalised** stage, with the **published** region files still committed to git.
- Weekly discovery and health checks that open GitHub issues.
- A coverage score per waterway, which drives both a public map and the contribution task list.

Ten sources need an owner decision before they are used. The biggest are Waterways Ireland's non-commercial licence, which covers the best all-island data, and reversing the earlier "use PaddlePoints with credit" decision.

## Authorities publish structures; only three describe portages

Each jurisdiction has one dominant authority with good machine-readable data, then a long tail of small bodies that publish only HTML and PDF.

**England.** The Canal & River Trust publishes about 40 ArcGIS layers, national and republished regularly. Its OGL "View" services were last edited in October 2026 and hold **1,722 locks, 1,108 weirs and 1,168 short-term moorings**, but only **57 slipways** and nothing on portages ([CRT Locks View](https://services.arcgis.com/DknzyjEEie5tEW0u/arcgis/rest/services/Canal_And_River_Trust_Locks_View/FeatureServer/0)). The richest crew-access layer, Towpath_Access_Points_2022 (**7,691 points** with gradient, steps and barrier fields), states no licence and was last edited in 2022 ([CRT towpath access](https://services.arcgis.com/DknzyjEEie5tEW0u/arcgis/rest/services/Towpath_Access_Points_2022/FeatureServer/0)).

The Environment Agency's navigations (Thames, Medway, and seven Anglian rivers) appear as GOV.UK guidance pages. These can be read as JSON through the Content API, with a `public_updated_at` timestamp to detect change ([GOV.UK Great Ouse](https://www.gov.uk/guidance/river-great-ouse-bridge-heights-locks-and-facilities)). Since 2026 the EA has also published per-river uMap maps, whose layers download as GeoJSON but carry no licence ([GOV.UK Nene](https://www.gov.uk/guidance/river-nene-bridge-heights-locks-and-facilities)). Only the Stour and the Medway name canoe portage platforms and launch points, and only in free text ([GOV.UK River Stour](https://www.gov.uk/guidance/river-stour-locks-and-facilities); [GOV.UK Medway](https://www.gov.uk/guidance/river-medway-bridges-locks-and-facilities-for-boaters)).

For weirs off the canal network, England has two OGL datasets. **AIMS Structure** covers EA-owned weirs, sluices and fish passes and is updated daily ([data.gov.uk](https://www.data.gov.uk/dataset/235b866e-fde8-475a-9ae3-72ae0744457b)). **River Obstacles** has **54,200** weirs, sluices, dams and fords, with heights. Its Rivers Trust hub entries contradict each other on the licence, giving both CC BY-SA 4.0 and OGL ([data.gov.uk River Obstacles](https://www.data.gov.uk/dataset/0df09ef3-9220-438a-8112-6879b3a51ac5)).

The Broads Authority contributes an OGL channel centre-line and nothing paddler-specific ([data.gov.uk](https://www.data.gov.uk/dataset/4d65b005-94a8-4056-af05-e663cbd35b4f)). The smaller authorities publish no datasets at all: Wey, Basingstoke, Avon, Cam, Middle Level, Chelmer & Blackwater, Bridgewater and the Royal Military Canal. Their rules (licence, closed locks, portage platforms) live in web pages, so OSM supplies the geometry there and the authority supplies the rules.

**Scotland.** Scotland is the cleanest case. Scottish Canals publishes static shapefiles under OGL 3.0: **91 locks, 57 weirs and 521 mooring points**. Of those points, **45 are typed "Canoe Landing"** and 223 "Pontoon" ([Scottish Canals data portal](https://www.scottishcanals.co.uk/scottish-canals-data-portal)). Catalogue copies say "licence not set", but the portal's own OGL statement is the one that counts. For rivers, SEPA's Obstacles to Fish Passage layer has **5,668 points**, is OGL according to its own item metadata, and needs no key ([SEPA MapServer](https://map.sepa.org.uk/server/rest/services/Open/Hydrography/MapServer/5)). The legal position also simplifies the planner: the Land Reform (Scotland) Act gives a statutory right of responsible access to most inland water, canoeing included ([Outdoor Access Scotland](https://outdooraccess-scotland.scot/act-and-access-code/land-reform-act/legislation-history)).

**Wales.** Wales has the least. Its canals come from CRT. Its only confirmed river navigation is the Wye from Hay to Chepstow, and the River Wye Paddle Guide PDF is Crown OGL material ([GOV.UK River Wye](https://www.gov.uk/guidance/information-to-help-boaters-on-the-river-wye); [Wye Paddle Guide PDF](https://assets.publishing.service.gov.uk/media/64c26161f92186000d866629/The-River-Wye-Paddle-Guide-March-2023.pdf)). Elsewhere, only **7 voluntary access agreements survive** out of attempts on more than 300 rivers ([Canoe Wales](https://www.canoewales.com/where-are-we-with-access)). DataMapWales has no weir or slipway layer, so the best Welsh weir source is the CC BY 4.0 **AMBER-GB** barrier atlas: 2,437 Welsh barriers out of 23,618 across GB, with a `height_m` field ([AMBER-GB FeatureServer](https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/AMBER_Barrier_Atlas_GB/FeatureServer)).

**Island of Ireland.** Waterways Ireland is the strongest single source in the inventory. It is keyless, edited the day before this research, and covers all nine navigations across both jurisdictions. It includes:
- **1,470 infrastructure points**, among them 399 canal locks and 143 river locks.
- **201 recreational access points**, including put-ins and **10 explicit "Carry" portages**.
- 330 facilities and 146 hazard notices.

The catch is the licence: "viewed, shared, and used for **non-commercial purposes**" with acknowledgement ([WI item 41fa6d65](https://www.arcgis.com/sharing/rest/content/items/41fa6d650cd045eaa0dcd56a5c521321?f=json); [WI Point Asset Inventory](https://services.arcgis.com/dYoxQ9gPdVpFX6Th/arcgis/rest/services/Point_Asset_Inventory_Public_View/FeatureServer/0)).

Off the navigations, the IFI National Barriers Programme is CC BY 4.0 and lists **2,446 weirs** in the Republic among 42,202 structures. It has no names or heights ([IFI NBP](https://services-eu1.arcgis.com/tnPmSZbB6GEKJjh8/arcgis/rest/services/NBP_Copy_view/FeatureServer/0)). Northern Ireland has **no open weir dataset** on OpenDataNI, and CanoeNI's trail access points exist only in a web map and PDFs with no stated licence ([CanoeNI](https://canoeni.com/Canoe_Trails.aspx)). Lough Neagh, the NI Blackwater and Strangford are not WI navigations, so OSM and contributions must carry them.

| Jurisdiction | Structures (locks/weirs) | Access and portage | Licence status |
|---|---|---|---|
| England, canals | CRT national layers | CRT towpath access (7,691); no portage data | OGL; towpath access has no licence |
| England, EA rivers | GOV.UK pages + uMap; AIMS; River Obstacles | Stour/Medway text only | OGL; uMap has none; River Obstacles conflicting |
| England, small authorities | OSM | Authority web pages, Go Paddling PDFs | No licence (credit) |
| Scotland | Scottish Canals; SEPA obstacles | 45 canoe landings; trail PDFs | OGL |
| Wales | CRT; AMBER-GB | Wye Paddle Guide | OGL / CC BY 4.0 |
| Ireland + NI navigations | Waterways Ireland | 201 access points, 10 carries | **Non-commercial** |
| ROI rivers | IFI NBP | iww.ie prose | CC BY 4.0 |
| NI rivers | OSM only | CanoeNI web map | No licence found |

## Paddler data is thin, closed, or both

The community side confirms the gap P0 found on the Devizes to Westminster route. Across Great Britain, OSM has **3 `canoe=portage` ways, 19 `canoe=put_in` nodes and 51 `waterway=access_point` nodes**, set against **4,796 lock gates and 4,881 weirs**. Ireland and Northern Ireland together have **0 portages, 457 lock gates and 940 weirs** ([Geofabrik taginfo GB](https://taginfo.geofabrik.de/europe:great-britain/keys/canoe); [Geofabrik taginfo IE/NI](https://taginfo.geofabrik.de/europe:ireland-and-northern-ireland/keys/canoe)). OSM is therefore a good *anchor* for portages, since the structures are mapped, but not a *source* of them. Its tagging also has no field for portage side, carry distance, rollers or landing height ([OSM Key:canoe](https://wiki.openstreetmap.org/wiki/Key:canoe)).

**PaddlePoints** is the largest UK paddler layer, but full use requires Paddle UK membership. Its terms give Paddle UK a sublicensable, perpetual licence over contributions and give third parties nothing ([PaddlePoints Terms](https://gopaddling.info/blog/paddlepoints/paddlepoints-terms-of-use/)). Its API endpoint answers "Unauthorised" ([gopaddling.info](https://gopaddling.info/)). That is not "no licence stated". It is a closed one-way grant behind a login, and it should come out of the current spec's "use with credit" list.

**CanalPlan** is the best community lock gazetteer and states no licence, but its download needs a login ([CanalPlan downloads](https://canalplan.org.uk/wiki/downloads:introduction)). **Wikidata** holds about **973 UK and Irish lock items under CC0**, almost all with coordinates, and **zero portage-trail items** ([Wikidata Query Service](https://query.wikidata.org/)). That makes it a clean source of stable identifiers for an open dataset.

The **DW race** publishes diagrams for **77 portages** over 125 miles. Veteran crews keep crib sheets with exit side and carry distance, which is the exact schema the product needs ([dwrace.co.uk](https://www.dwrace.co.uk/info); [SUP Mag DW guide](https://standuppaddlemag.co.uk/2026/04/16/dw-a-guide-for-sup-entrants/)). The two richest prose sources, UK Rivers Guidebook and IrishWhitewater, have unknown or unretrievable terms and are guidebook text, not data ([iww.ie](https://iww.ie/rivers/river/1790-boyne-meath/)). No project called OpenLocks or OpenPortage exists.

## Base layers are open everywhere except Welsh levels, Irish names and aerial imagery

Base data is almost complete under the owner's rules. The gaps are specific and known.

| Layer | GB | Island of Ireland | Notes |
|---|---|---|---|
| River and canal network | OSM via Geofabrik `britain-and-ireland` PBF, 2.4 GB, daily ([Geofabrik](https://download.geofabrik.de/europe/britain-and-ireland.html)) | Same OSM extract; EPA WFD routes (CC BY 4.0, WFS) ([data.gov.ie](https://data.gov.ie/dataset/river-network-routes)); DAERA Strahler (OGL) | OSM is the only all-nations source with canals; the national hydrography is for cross-checks |
| Gazetteer | OS Open Names, OGL, quarterly ([OS](https://docs.os.uk/os-downloads/addressing-and-location/os-open-names/os-open-names-overview)) | Tailte townlands gazetteer (CC BY 4.0) ([data.gov.ie](https://data.gov.ie/dataset/townlands-national-placenames-gazetteer1/resource/bb40f6d1-4991-44a6-9f90-6f90d61225ec)); OSNI 336 towns (OGL) | Logainm needs an API key, so it is out ([Gaois](https://docs.gaois.ie/en/data/getting-started)); bridge, lock and pub names come only from OSM and Wikidata |
| River levels | EA flood-monitoring (OGL, no key) ([EA](https://environment.data.gov.uk/flood-monitoring/doc/reference)); SEPA KiWIS, 777 stations, OGL, no key ([SEPA](https://timeseriesdoc.sepa.org.uk/api-documentation/before-you-start/what-data-are-available/)) | OPW waterlevel.ie, about 465 stations, CC BY 4.0 ([OPW](https://waterlevel.ie/page/api/)) | **Wales:** NRW needs a key and caps storage at 1 year ([NRW](https://metadata.naturalresources.wales/geonetwork/srv/api/records/NRW_DS116446)). **NI:** DfI's 130 stations have no API ([DfI](https://www.infrastructure-ni.gov.uk/articles/dfi-rivers-water-level-network)) |
| Tides | EA tide gauges, 44 sites, 4 weeks live + daily archive ([EA](https://environment.data.gov.uk/flood-monitoring/doc/tidegauge)); SEPA tidal series | Marine Institute ERDDAP: predictions at 37 ports + gauges, CC BY 4.0, no key ([ERDDAP](https://erddap.marine.ie/erddap/info/IMI_TidePrediction_HighLow/index.json)) | BODC history needs registration, so it is out ([BODC](https://bodc.ac.uk/data/hosted_data_systems/sea_level/uk_tide_gauge_network/request)) |
| Imagery (print-safe) | EOX Sentinel-2 cloudless **2016 only** (CC BY 4.0) ([EOX licence](https://cloudless.eox.at/license-non-commercial)) | Same | 2018–2025 EOX is NC-SA. APGB is public-sector only. Tailte and OSNI orthophotos are paid. EA vertical aerial says "All rights reserved" ([data.gov.uk](https://ckan.publishing.service.gov.uk/dataset/vertical-aerial-photography)) |
| Printable basemap | OS Open Zoomstack, GB only, six-monthly ([OS](https://www.ordnancesurvey.co.uk/products/os-open-zoomstack)) | Protomaps PMTiles of OSM, self-hosted (ODbL produced work) ([Protomaps](https://docs.protomaps.com/basemaps/downloads)) | One OSM style across all five nations is simpler than Zoomstack plus a fallback |

Two of these change the existing spec. First, the spec lists EA Vertical Aerial Photography as OGL, but its data.gov.uk record reads "All rights reserved" while its sister oblique dataset says OGL. Until that is settled, imagery for print is EOX 2016 at 10 m, which is too coarse to show a portage. Second, Zoomstack does not cover Ireland, so print should standardise on self-hosted OSM vector tiles for all five nations.

## Devizes to Westminster portages (checked 2026-10-31)

What each source says about the 77 DW locks: which bank to land on, where to get out and back in, and the carry. The scorecard is `packages/waterways/data/dw-coverage.md`; on 2026-10-31 it had **0 of 77** for portage side, take-out and put-in, and 1 of 77 for the carry (Molesey's rollers, from OSM). No open source can raise the first three.

| Source | Licence | What it has for DW portages | Use |
|---|---|---|---|
| OpenStreetMap | ODbL | 4 `portage=*` ways in the DW box. Molesey's boat rollers (`way/1364616083`, 18 m, `portage=designated`) are below the 40 m floor `osmPortages` uses for landing steps, so they count as a carry only. The other three are steps near Eton, 1.3 km from Boveney Lock. | Yes, OSM layer only. The scorecard counts mapped paths as landings since 2026-10-31. |
| Canal & River Trust ArcGIS services | OGL (locks); none stated (facilities, towpath access) | Locks, slipways, facilities, towpath access. None of its services is about portages, landings or canoes. | Locks yes; nothing to use for portages. |
| EA "River Thames: locks and facilities", 19 lock-and-weir site guides | OGL v3 | Facilities and anglers' access. Nothing on canoes, except Molesey's footbridge "over the boat rollers". | Yes, but nothing for portages. |
| GOV.UK canoe portage publications | OGL v3 | Only for the Nene (Upper Wellingborough) and the Stour (Lamarsh). None on the Kennet or the Thames. | Not on this route. |
| paddlesnitch contributions (`/plan/data/latest/openportage`) | CC0 | 0 on 2026-10-31. | Yes. The scorecard reads this file since 2026-10-31. |
| DW race handbook 2026 (`dwrace.co.uk`) | © The Devizes to Westminster Organisation Limited, all rights reserved | A portage diagram for every race portage, including Dreadnought Reach. Images, not data. | Find and check only. Ask 1 below. |
| Go Paddling paddle trails (Paddle UK) | No open licence found; the site refuses scripted fetches | Trail PDFs for Reading–Henley, Henley–Marlow, Hurley–Maidenhead, Hampton Court–Richmond and Devizes–Honey Street give the portage side at some locks. | Find and check only. Ask 2 below. |
| PaddlePoints (Paddle UK) | Membership terms, rights to Paddle UK | Access and launch points behind a membership wall; nothing on lock portages. | No. |

**Our own evidence is the way to raise the score.** All three routes land in the same CC0 contribution layer, which the scorecard and `/plan/gaps` read:
- **The owner's paddles:** a saved paddle past a lock shows "Carries on this paddle" (`portagesFromTrack`), published after the CC0 tick.
- **On the water:** *Add portage details* on the lock's stop in Plan, with photos and notes kept by the owner.
- **Imagery:** landings traced over Esri World Imagery are ours. Esri's "World Imagery Uses Permitted" allows tracing and publishing the lines, even to open data (`river-planner.md`, "SATELLITE"). A side read off imagery alone is a guess, though: confirm it on the water or against a paddle before publishing it.

A find-and-check source tells us which bank to look at when we confirm a lock. What we publish comes from our own landings, never from their list, and we never commit their facts to this public repo.

### Permission asks

The owner sends these; nothing from these sources is copied until one is granted.

**Ask 1: the DW race.**
- **Who:** The Devizes to Westminster Organisation Limited, through its Course Secretary (`coursesecretary@dwrace.co.uk`, on `dwrace.co.uk/contact`).
- **What:** permission to use the race portage facts from the handbook in paddlesnitch's free planner: which bank, take-out and put-in for each lock, and the compulsory portage at Dreadnought Reach. Each fact would be credited to the race and linked to the handbook. We'd draw our own maps from the landing points and wouldn't reproduce their diagrams. Best is an open licence (CC BY 4.0), so the facts can sit beside OGL data and in printed sheets. Second best is written permission to use them with credit.
- **Why:** many crews build their route sheets by hand. Open data has none of the 77 portage sides, and the race is the authority on where its portages are. In return, every crew can print free route and crew sheets from the planner, and the race gets a public list of what's still unknown (`/plan/gaps`), and corrections from paddlers that it can use too (CC0).

**Ask 2: Paddle UK, for the Go Paddling trail guides.**
- **Who:** Paddle UK, which publishes `gopaddling.info` (contact still to find).
- **What:** permission to use the portage side and landing points from its Thames trail guides, credited and linked, or the facts behind them under an open licence.
- **Why:** they cover about ten of the DW Thames locks (Sonning to Boulters, and Teddington), and other rivers we plan on. Its Kennet & Avon trail, Devizes to Honey Street, has no locks. The planner is free and made for the same paddlers Paddle UK serves, and every fact would credit and link the guide.

## Ten sources need an owner decision before they ship

| # | Source | Issue | Recommendation |
|---|---|---|---|
| 1 | **Waterways Ireland** ArcGIS layers | Explicitly **non-commercial**, which is neither "no licence" nor "prohibited" ([WI item](https://www.arcgis.com/sharing/rest/content/items/41fa6d650cd045eaa0dcd56a5c521321?f=json)) | Use while the planner is free, and write to WI asking for a reuse permission. Keep it in its own `source_id` so it can be withdrawn. **Never** let it feed the CC0 or OSM layers |
| 2 | **PaddlePoints** | Membership-walled; terms grant rights only to Paddle UK | Reverse the 2026-10-11 decision: exclude it, and approach Paddle UK as a partner instead |
| 3 | **NRW river levels** | Free, but needs a key, and storage is capped at 1 year | Accept a Welsh level gap (cross-border EA stations partly cover it), or make a one-off exception |
| 4 | **OPW waterlevel.ie** | Asks for a courtesy email; only stations below 41000 may be republished | Send the email (it is not a sign-up); enforce the station cutoff in code |
| 5 | **River Obstacles** (England) | Hub entries say both CC BY-SA 4.0 and OGL | Prefer AIMS + AMBER-GB; if used, treat it as share-alike in its own layer |
| 6 | **AMBER** | GB copy is CC BY 4.0; the EEA calls the pan-European atlas "copyright-protected" ([EEA](https://www.eea.europa.eu/en/analysis/maps-and-charts/man-made-river-barriers-in/)) | Use the GB copy with the required citation; settle the European atlas at P7 |
| 7 | **EA water recreation locations** | OGL wrapper around contributor data that includes CC BY-NC-SA ([data.gov.uk](https://www.data.gov.uk/dataset/79b61813-d8f1-4888-8fcc-555305780a07)) | Hint layer only, never published |
| 8 | **EA vertical aerial** | "All rights reserved" against the spec's OGL | Ask the EA; until then, don't print it |
| 9 | **CanalPlan** | No licence, but a login to download | Ask the Atty family directly; use for cross-checks only |
| 10 | **CRT notices; CanoeNI; DW diagrams; Go Paddling PDFs; EA uMap** | No licence or terms found; some need scraping | Use with credit under existing policy, but invite the DW organisers and CanoeNI to contribute under CC0 rather than scraping them |

Two smaller points sit outside the table. Logainm and BODC fail the no-sign-up rule outright. The `ADMIRALTY` reference in the spec's P5 phase row contradicts decision 5 and should be corrected to the EA harmonic fit.

## Five layers of organisation turn the patchwork into a product

This plan keeps P0's shape: pure parsers in `packages/waterways/src/ingest/`, an assembled `data/{region}.json` committed to git, a coverage report next to it, and three licence layers. It changes two things. Sources become **registry entries** instead of code, and **fetching moves from per-region-bbox to per-dataset**, so a national layer is pulled once and cut into regions at assembly.

### A source registry, one file per dataset

The registry follows OpenAddresses, which files one JSON per source at `sources/{country}/{region}/{source}.json`. Each file holds a raw-data URL (not the portal), the protocol, the coverage, a licence block, and a `conform` mapping. A source can be registered before it is mapped, so the registry doubles as the backlog ([OA CONTRIBUTING](https://github.com/openaddresses/openaddresses/blob/master/CONTRIBUTING.md)).

For paddlesnitch that becomes `packages/waterways/sources/{gb|ie}/{eng|sct|wls|nir|roi}/{publisher}-{dataset}.json`. Each record holds:
- `id`, `publisher`, `website`, `data`
- `protocol`: one of arcgis, wfs, ckan, govuk-content, shapefile-zip, geofabrik, html, pdf-manual
- `layers`: locks, weirs, access, facilities, hazards, gauges, network, names
- `coverage`: a nation code or bbox
- `conform`: how source fields map to `Feature`
- `cadence`, `status` (`candidate | active | broken | withdrawn`), and `supersedes`
- `licence`: Transitland's tri-state flags (`commercial_use_allowed`, `share_alike`, `redistribution_allowed`, plus `attribution_text`) ([DMFR](https://github.com/transitland/distributed-mobility-feed-registry))
- a `decision` field naming the owner ruling that admitted the source

Today's `sources.ts` is then generated from the registry, so `/plan/sources` and print footers can never drift from what was actually ingested. A JSON Schema check in `checks.yml` validates every file. Mutable run state stays out of the registry. Last fetch, ETag, hash, feature count and error live in machine-written state, so cron runs don't produce noisy commits.

### Pull jobs on two axes: dataset and locality

**Dataset jobs** are national and few. Examples: CRT layers, the GOV.UK EA navigation set, AIMS, Scottish Canals, SEPA obstacles, AMBER-GB, WI, IFI, OSM filtered from the Geofabrik PBF, Wikidata locks. Each fetches its whole jurisdiction once and knows nothing about regions.

**Locality jobs** cover the long tail, and each is scoped to one waterway. Examples: a council's slipway layer, one EA uMap, the Wye Paddle Guide, the Spey access table, a trail PDF. The manual ones (PDF transcription) are tracked as GitHub issues with `protocol: pdf-manual`. Their output is a committed curated JSON file, as the spec already plans for hand-drawn portages.

**Region builds** are the third piece. They become pure assembly: select by geometry from every normalised dataset, conflate, score coverage, write the gold file. Regions should be keyed by navigation system or catchment (Thames, K&A, Grand Union, Caledonian, Shannon, …) rather than by race corridor, and grouped by nation. That way coverage reads naturally ("Shannon: good") and a region file stays at P0's size of a few hundred KB.

Every job, of either kind, has the same contract:
1. Read its registry entry.
2. Probe cheaply for change: ArcGIS `editingInfo.lastEditDate`, GOV.UK `public_updated_at`, CKAN `metadata_modified`, HTTP ETag. Skip if nothing has changed ([ArcGIS IEditingInfo](https://developers.arcgis.com/arcgis-rest-js/api-reference/arcgis-rest-feature-service/IEditingInfo/); [CKAN API](https://docs.ckan.org/en/latest/api/index.html)).
3. Otherwise fetch, hash the normalised bytes, and snapshot raw only when the hash is new.
4. Run the pure parser to produce canonical features carrying `source_id`, `record_id` and licence.
5. Write a `state.json` with counts, warnings and the age of the source.

Fetch mechanics are deliberately left open for now. The contract is what lets them be swapped later.

### Staging: raw and normalised in S3, published in git

The layout mirrors OpenAddresses, which keeps sources in git and artefacts in object storage ([OA DEVELOPMENT](https://github.com/openaddresses/openaddresses/blob/master/DEVELOPMENT.md)). It also uses Willison's "commit only if changed" git scraping on the small, reviewable layer ([Willison](https://simonwillison.net/2020/Oct/9/git-scraping/)):

| Stage | Location | What it holds |
|---|---|---|
| Raw | `s3://…/waterways/raw/{source_id}/{date}/{sha256}.{ext}` | Immutable snapshots, written only when the hash changes, under a lifecycle rule. Kept out of git because of bulk and because some licences limit redistribution. The local `.cache/waterways/` remains the developer mirror. |
| Normalised | `s3://…/waterways/normalised/{source_id}/latest.geojson` + `state.json` | One file per source, in the canonical schema, before any merging |
| Published | `packages/waterways/data/{region}.json` + `{region}-coverage.md` in git | As today |

Because the published files stay in git, every refresh arrives as a PR diff, and rollback is a `git revert`. A PR that touches a registry entry should run only that source and comment with feature count, added, removed and moved, as OpenAddresses' CI does.

Conflation keeps a paddlesnitch ID per feature, a committed crosswalk (`crosswalk/{kind}.csv`), and per-property provenance in Overture's style ([Overture schema](https://docs.overturemaps.org/schema/reference/places/place/)). Precedence is set per property: authority wins on geometry and name, contributions win on portage side and landing. The three licence layers stay as built, extended as follows:
- Core takes OGL, CC BY, credited no-licence sources, and anything curated.
- WI's non-commercial data gets its own tagged slice.
- OSM stays a separate ODbL table.
- Contributions remain CC0.

### Discovery and health on a weekly cron

GitHub Actions cron is enough at this scale, with three caveats: runs can be delayed or dropped at the top of the hour, they run only on the default branch, and public repos auto-disable them after 60 days of inactivity ([GitHub Docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)).

The weekly cron runs three jobs:
1. **Refresh** every active source, staggered by publisher host.
2. **Discovery:** saved CKAN searches on data.gov.uk, data.gov.ie and OpenDataNI, plus ArcGIS Hub searches for lock, weir, slipway, portage, canoe, blueway and navigation. Any dataset ID not already in `sources/` opens a `candidate-source` issue, which plugs into the existing backlog-issue workflow.
3. **Health:** a source that fails N runs in a row flips to `broken` and opens an issue, the same `status`/`redirect` idea the Mobility Database uses ([mobility-database-catalogs](https://github.com/MobilityData/mobility-database-catalogs)).

Two exceptions to the weekly cycle. Live river levels stay on runtime calls or EventBridge + Lambda, not in the dataset pipeline. Tidal constituents are refitted yearly.

### Public coverage and the contribution loop

Coverage is computed per waterway reach by the region build, extending today's per-lock coverage report. It scores six things:
- whether authority structure data exists
- whether each lock or weir has portage side, take-out and put-in
- crew access per 10 km
- whether facilities are known
- whether a level gauge is within reach
- the age of the newest source

The legal context is shown as its own label, not as a score: licensed navigation, Scottish statutory access, Wye navigation, or "contested, check locally".

The build publishes `coverage/{region}.json` plus a single all-UK-and-Ireland GeoJSON. Together these drive the shaded map, `/plan/gaps`, and an honest "we cover X" page that names greyed-out nations and sources awaiting decisions. OpenAddresses likewise renders its coverage map from the registry's `coverage` blocks ([OA CONTRIBUTING](https://github.com/openaddresses/openaddresses/blob/master/CONTRIBUTING.md)). Gaps become tasks: "lock with no portage side, ranked by plan frequency" is the in-app list. OSM-side gaps, such as a CRT or WI lock missing from OSM, can be exported as a MapRoulette challenge, which reuses volunteer tooling rather than building it ([MapRoulette docs](https://learn.maproulette.org/en-US/documentation/creating-cooperative-challenges/)).

Contributions work as the spec already decided: CC0 on publish, live immediately, flag-and-hide. A nightly job exports published contributions into the normalised stage as source `contribution`, so they conflate like any other source and show up in the next region diff.

### Start OpenPortage, as a CC0 dataset that sits beside OSM, not inside it

Yes, start it. Nothing like it exists. Wikidata has no UK or Irish portages. The fields paddlers need are well defined: direction of travel, river-left or river-right take-out and put-in, landing type and height, carry line and distance, rollers or trolley, hazards, compulsory status, access, and `verified_at`. CC0 is the licence that lets the data flow everywhere ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)).

**Phase it.** At first, OpenPortage is simply paddlesnitch's contribution layer, published as a weekly CC0 dump at a stable URL. Spin it out into a sibling public repo (`open-portage`, with its own schema, CI and CONTRIBUTING) once outside contributors or partners such as the DW organisers, Paddle Scotland and CanoeNI want PR access.

**Relation to OSM.** OpenPortage relates to OSM through references only. Each record anchors to an OSM lock or weir ID and/or a Wikidata QID, and its geometry comes from contributors' own GPS traces or observations, never copied from OSM. ODbL share-alike forbids pulling OSM data into a CC0 set. CC0 data can flow into OSM, though, because the OSMF rates CC0 and OGL as compatible ([OSMF compatibility](https://osmfoundation.org/wiki/Licence/Licence_Compatibility)). The CONTRIBUTING grant must therefore say "my own observation, not copied from OSM, a guidebook or a non-commercial source". Two consequences follow:
- **CC BY sources** (IFI, OPW, Tailte, AMBER) cannot go into OSM without a waiver, so they never feed OpenPortage.
- **WI's non-commercial layer** must never feed it either, even though WI's 10 "Carry" points are the closest thing to an Irish portage dataset.

Pushing verified portages into OSM as `canoe=portage` and `canoe=put_in`/`egress` should wait. It needs the formal import process: a wiki plan, a 14-day community review, and a dedicated account ([OSM Import/Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines)). Until then, OpenPortage stays the system of record and OSM mappers are free to use it.

### Rollout order

Each wave closes when its coverage map is published.
1. **England, national datasets.** Remove the bbox from the CRT pulls, add the full GOV.UK EA set (Thames to Lechlade, Medway, the Anglian rivers), AIMS and the Broads. This is P6.
2. **Scotland.** Scottish Canals, SEPA levels and obstacles, and the statutory-access flag.
3. **Island of Ireland,** depending on the WI decision. OPW, ERDDAP, IFI, EPA routes and the Tailte gazetteer, with OSM and contributions for NI rivers.
4. **The long tail.** Wales (Wye guide, AMBER), the small English authorities and the trail PDFs, as locality jobs.
5. **Netherlands** (P7). Rijkswaterstaat's CC0 FIS slots into the same registry under `sources/nl/`, but only after the UK and Ireland map shows no unexplained grey.

## Conclusion

Coverage will not be decided by finding more authority data. That data is now nearly fully inventoried, and for structures it is good everywhere except Northern Irish rivers and Welsh levels. It will be decided by how fast paddlers fill the portage fields that no publisher records. This reverses the usual priority. The pipeline only needs to be dependable and boring, a registry plus weekly diffs. The contribution loop needs to be excellent: a coverage map that shows exactly which lock lacks a landing side, a one-tap correction, and a CC0 dump that partners can adopt. Waterways Ireland's 10 "Carry" points and Scottish Canals' 45 "Canoe Landings" show that authorities would record portages if asked. A clean, public, CC0 OpenPortage schema is the thing that could eventually persuade them to publish in it.

Two risks deserve attention. The first is licence drift. WI's non-commercial terms, the conflicting River Obstacles statements and the PaddlePoints terms all show that what a source permits must be recorded per source and re-checked, because one bad ingest can taint a CC0 layer that is hard to clean. The second is honesty about gaps. In NI, Wales and contested English rivers, a map showing "poor coverage" is more truthful than one showing guessed access, and the planner's credibility rests on that.
