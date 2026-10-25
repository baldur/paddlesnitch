# Game courses from 360 video

✅ Shipped 2026-10-24: **Reading Thames**, Christchurch Bridge to Mapledurham, and the **Time Trial Loop**, the canoe club's loop round St Mary's and Fry's islands, in the kayak game (`/games/kayak/`).

A toolchain that turns paddling videos with GPS into a real river in the kayak game. It's built so that more courses are the same few commands. The longer-term aim is to let other people submit video, so the toolchain doubles as a way of surveying rivers: what's on each bank, where boats moor, where the locks and slipways are.

## The idea

A GoPro MAX `.360` file carries a telemetry track with GPS at 10 Hz alongside the video. So every frame of video has a place. The river's *shape* comes from OpenStreetMap; the video says *what it looks like* at each place. The game is low-poly and flat-coloured, so we don't reconstruct the footage in 3D (water and a moving camera make photogrammetry poor, and the result wouldn't fit the style or a phone). The footage is reference: it decides which landmarks get modelled, which bank is park and which is wild, where boats are moored.

## The pipeline

All steps live in `apps/web/scripts/courses/`, run with `pnpm --filter web <step>`. Working files go to `apps/web/.cache/courses/` (gitignored: frames are hundreds of MB). What's committed is the course config, the observations, and the game's course file.

| Step | Command | In | Out |
|---|---|---|---|
| 1. Telemetry | `course:ingest <folder or files>` | GoPro chapters (`GSccNNNN.360`, `GX…mp4`) | `.cache/courses/<NNNN>/track.json` per recording: every usable fix on the recording's clock |
| 2. River | `course:river <id>` | `data/<id>/course.json`, the tracks, OSM (Overpass, cached) | `.cache/courses/<id>/river.json` (centreline every 10 m, bank distances, everything mapped beside it) + `river.svg` map |
| 3. Frames | `course:frames <id> [--step 50]` | tracks, river line, the videos | a 360 frame and ahead/left/right/behind views every 50 m of every pass, `frames.json`, contact sheets |
| 4. Observations | by hand (for now) | the frames | `data/<id>/observations.json` (committed) |
| 5. Course file | `course:build <id>` | river + observations | `games/kayak/courses/<id>.json` (committed, shipped with the game) |
| 6. Review | `course:compare <id>` | course file + frames | `.cache/courses/<id>/compare.html`: the game's view next to the camera every 250 m |

### 1. Telemetry (`ingest.ts`, parser `packages/timing/src/gpmf.ts`)

`ffmpeg -map 0:m:handler_name:"GoPro MET" -c copy -f data` pulls the telemetry stream out of a 10 GB chapter in about a second. `parseGpmfGps` (pure, tested in `apps/web/src/lib/gpmf.test.ts`) reads GPMF's key-length-value format: **GPS9** (HERO11+, MAX 2: each row has its own time, DOP and fix) and **GPS5** (older cameras: the payload's GPSU time, GPSF fix, GPSP DOP). Each fix gets `at`, its place on the video clock in payload units (payload k covers [k, k+1); `at × duration / payloads` = seconds into the file). Fixes without a 3D fix or with DOP over 5 are dropped. Chapters of a recording are joined on one clock.

### 2. River (`river.ts`, geometry `lib/river.ts`)

`course.json` gives the river's name and four points: `from`/`to` (the ends of the river line) and `start`/`finish` (the race lines). `osmFrom` reuses another course's OSM downloads for the same water. The centreline is the mapped river ways chained from `from` to `to` (Dijkstra). Where the river splits round an island, the channel nearer the paddler's GPS track wins (each edge's cost grows with its distance from the track). The ends are trimmed so the line never doubles back past an end point. Bank distances come from rays cast square to the line against every shoreline (river areas, islands, lock walls). The line is then moved to the middle of the water and smoothed. Game coordinates: metres, x east, **z south** (so the game's heading is a compass bearing).

Overpass mirrors often refuse requests, so each mirror is tried three times and responses are cached. If it ever becomes a blocker, read a Geofabrik extract the way the river planner does.

It also writes the **water's outlines** (each mapped river area and island ring once; an area's outline is kept whole, or the game's in-the-water test breaks). Where two mapped areas meet mid-river, their shared edge is dropped from the shoreline, or the bank rays would find a false bank there.

**A route** (`route` in `course.json`) is a racing line that isn't the river line: a loop round islands, say. It's a list of legs: `{ along: [a, b] }` follows the river line between two points (either way), `{ way: <OSM id>, reverse? }` follows a mapped waterway (side channels have their own), and a bare `[lat, lng]` goes straight to a point (for a turn round the end of an island, or through a gap). The legs are joined, resampled every 5 m and given the open water each side; `start`/`finish` are found near its beginning and end (they can be the same place). Don't recentre a route: it wobbles through junctions and cuts hairpins. Put the points in mid-channel instead, and check the drawn map.

### 3. Frames (`frames.ts`, passes `lib/passes.ts`)

Each recording's fixes are placed on the line and split into **passes** at each turn round (`passes()`: a turn is coming back 100 m from the furthest point; passes under 200 m are dropped). An out-and-back gives two views of every bank. For every 50 m a pass covers, ffmpeg seeks to that moment and writes the 360 as equirectangular plus four flat views (90° wide).

**GoPro MAX layout:** each of the two video streams is three equi-angular cube faces (left/front/right, then down/back/up), 1344 px each, with 32 px of overlap on the outer faces. Cropped and stacked 3×2 that's YouTube's EAC, which ffmpeg's `v360=eac` reads directly.

**Which way the camera faced** can't be told from the telemetry, so it's set per recording (`cameraYaw` in `course.json`, degrees from the bow). Every output is turned so the bow is straight ahead. In the Reading recordings the camera was on the back deck looking forward over the paddler (`cameraYaw: 180`). This was found from the frames: the sun was "ahead" on a westward morning paddle, and Caversham Bridge appeared only after passing it. Check this first on any new footage. With the camera behind the paddler the forward view is blocked; the **behind view from a pass going the other way** is the clear look up the course, and `course:compare` uses it.

### 4. Observations (`data/<id>/observations.json`)

What the frames show, **tied to places, not to the course**: each item has `at` (or `from`/`to`) as lat/lng, the camera's `heading`, `side` (left/right of travel at that heading), and `frame` naming the evidence. Kinds used so far:

- `bank`, with `cover`: `park`, `trees`, `gardens` or `wild`.
- `moorings`, with `boats`: `cruiser`, `narrowboat`, `trip-boat`, `tatty` (tired old cruisers: tarps, faded paint, flags) or `mixed`.
- `buildings`, with `style: 'flats'`.
- `bridge`, with `style` (`cable-stayed` or `concrete-arch`) and `mast`.
- `railway`.
- `wall`: a quay or revetment at the water's edge.
- `landmark`, with `style`: an unnamed building to draw as a bespoke model, given by a point beside it (`at`): the nearest OSM footprint within 40 m gets the style. Named buildings use `styles` in `course.json` instead.
- `posts`, with `points` (lat/lng each): posts standing in the water. Solid in the game.
- `anglers`, with `count` and a stretch (`from`/`to`, `side`): people fishing from that bank, spread along it.

**Owner's spots (2026-10-25).** The owner gave GPS points for things to make more recognisable. Finding them in the footage: take each recording's `track.json` (from `course:ingest`), find the fixes within ~40 m of the point, one per pass, and pull flat views from the 360 at that moment towards the point (ffmpeg `v360` as `frames.ts` does, a narrow `h_fov` to zoom). From those came the posts off St Mary's Island, the riverside villa, the spiral-stair and grey boathouses, the canoe club's details, the tatty cruisers below Caversham Bridge and the anglers on the Promenade.

A course can use another's observations (`observations` in `course.json`): the Time Trial Loop uses Reading's, placed on its own river line.

**Pitfall: a pass up a different channel.** An observation is placed where the *camera* was and projected onto the course line. If the camera was in another channel round an island, the side comes out wrong: a row of cruisers on the island's far side ended up on the course's left at Fry's Island. Label from a pass that follows the course's own channel, or (better, for the vision-model step) record where the *thing* is rather than the camera.

Because they're geo-referenced, the same observations can feed another course on overlapping water, or the river planner (moorings, landing stages, locks). For Reading they were labelled by Claude from frames every 100 m. The next step is a vision model labelling frames (Bedrock, as the Analyse insights do), with a person checking.

### 5. Course file (`build.ts`, pure `lib/course-file.ts`, tested)

Combines the river and the observations into what the game draws:

- `line` and `width`: a running median takes out spikes where a ray slipped into a side stream, clamped to 20–100 m.
- `banks` (cover per stretch), `walls`, `moorings` (rows of boats filling each observed stretch), `bridges` (one per crossing cluster, under the bridge's own OSM name, styled from the observations).
- `places`: the landmarks named on screen as you pass them, from the course's `places` list of OSM names (optionally relabelled, or `{ label, at }` for a point of your own) in `course.json`. On the river line each is named where the line comes nearest; on a route, once each time the route goes by, as you come up to it.
- `birds`: where swans crowd (`{ near: <OSM name>, count, spread }`).
- `styles`: OSM building names drawn as bespoke models (`rowing-club`, `canoe-club`), modelled from the frames; `landmark` observations add more by position (`spiral-boathouse`, `grey-boathouse`, `riverside-villa`).
- `posts` (x, z each) and `anglers` (`{ s, side }` on the river line), from those observations.
- `water`, and `route` (its line every 5 m and the open water each side, smoothed per side).
- OSM `buildings` (footprints with heights; `building:levels` when mapped), `woods`, single `trees`, `railways`, `locks` and `weirs`.

The file carries `credit` and `licence`. **It's derived from OSM, so it is an ODbL database.** The game's menu credits OpenStreetMap.

### 6. Review (`compare.ts`)

Serves `games/`, plays the course in Chrome with `#debug`, puts the boat at each spot, and screenshots it next to the real frame. This is how the tree density and size were tuned: the first version's banks were thin and low, while the real Thames is lined with 10–20 m trees and scrub over the water.

## In the game

- **Real size, ×4 time (owner's choice):** the river is its true size and shape. `course.speedup = 4` makes every boat move 4× its speed through the world (`sim.js` `move()`), and `warp = 4` shows times 4× longer. The HUD therefore shows true distances and times a real paddler would recognise, and the 6.3 km plays in about 7 minutes. Turning circles scale up 4× too, which suits the Thames's bigger bends. Physics, stroke rates and speeds are unchanged.
- **A race:** the Division 9 pack races it. Lining up happens at true speed, and every boat switches to `speedup` at the horn. The AI scales its distances by the speedup (kick for the line, sprint off it, station-keeping on a wash, look-ahead for steering and moorings). Tested headlessly (`kayak-race.test.js`): everyone finishes in about 28-30 real-equivalent minutes, with no capsizes and nobody stuck on a bank.
- **Loading:** `courseFromFile(data)` / `loadCourse(url)` in `course.js`. The file is fetched the first time the course is picked from the menu.
- **Scenery:** `world.js` draws `course.scenery` with its own builders:
  - banks coloured by cover, and trees planted by cover (broadleaf only, full-grown), with scrub at the water's edge, weeping willows and landing stages;
  - woods, and buildings extruded from their footprints (hipped roofs on houses and boathouses);
  - the cable-stayed Christchurch Bridge and the concrete-arch Caversham Bridge;
  - cruisers, narrowboats and trip boats;
  - a railway embankment with overhead-line portals;
  - locks and weirs, when they're on the line;
  - land shaped by the mapped water: strips out from the river line whose points dip under the surface wherever the outlines say it's water, so islands and side channels appear (extra rows round water behind an island; far rows every 12 m);
  - quays and revetments (`walls`), pontoons in front of boathouses near the water, windows on the walls that face the river;
  - bespoke landmarks (`styles`): Reading Rowing Club (white clubhouse, red hipped roof and cupola, balcony and stairs, flag, a hard down to the water) and Reading Canoe Club (red-brick boathouse, a dark hipped roof over a white-railed balcony on brick pillars, roller doors, a glass door under its name in blue on white, kayak racks, a grass bank and wide concrete steps down to a grey pontoon), each with its name in blocky letters; and three the owner pointed out: the tall red-brick boathouse with white spiral stairs, the long grey two-storey boathouse beside it, and the grey-blue clapboard villa by St Mary's Island with its quay, urns, summerhouse and white tower. Trees keep clear so they're seen from the water. A model stands where the mapped bank is (`facing()`'s `edge`: the nearer of the river line's width and the mapped shore);
  - tall concrete posts in the water off St Mary's Island (solid: in `course.shore` with the moored boats);
  - tatty cruisers below Caversham Bridge (their own random draws, so the rest of the world is unchanged);
  - anglers on the Promenade's wall, under green umbrellas, each with a rod and a line out to an orange float (`anglers.js`; see below);
  - bridges that span all the water they cross (Caversham Bridge reaches over Piper's Island's north channel, with a pier on the island);
  - a cloudy sky;
  - the ends closed off 320 m deep so the water plane doesn't show past them.
- **Size:** Reading about 335k triangles, the loop about 150k, against the made-up race's 98k. The test caps Reading at 400k.
- **Named places:** the HUD names each landmark in `places` as you come up to it, one at a time.
- **Anglers** (`anglers.js`, pure, tested): paddle across the low end of a line (where it's below head height; nearer the bank you pass under the rod) and it snags you once: the boat keeps a quarter of its speed, the angler shouts "Oi! Mind my line!" and the screen says so. Lines reach 7 to 11 m out, never more than 45% of the way across. The rivals pass them on the float's side, as they pass a boat. Fixed by the course, no randomness, so live races agree.
- **Swans and ducks** (`birds.js`), on every course: swans drift and barely move aside, so you steer round them or capsize; ducks fly off. Crowds by Reading Rowing Club.

### The Time Trial Loop

Owner's course, 2026-10-24: from Reading Canoe Club up the narrow back channel of St Mary's Island, through the ~9 m gap at its west tip (between it and a little islet: "only one or two boats side by side"), back down the main channel past the club, north of Piper's Island, down the north side of Fry's Island, round its east end (by Christchurch Bridge), back up the south side, south of Piper's, and home to the club: 5.4 km. St Mary's Island isn't named in OSM; it's the islet at 51.4697, -1.0045.

**Re-routed 2026-10-25** (the owner): down through Caversham Bridge's **right (south) arch**, down the **main channel, right of Fry's Island**, **turn left round its end before Christchurch Bridge**, back up the **back (north) channel behind it**, and past Piper's Island **either side** (the left, south arch, is quicker and is the racing line; the narrow bit right of it, in front of the Reading University boathouses, often has swans: a flock is placed there). 5.43 km. Rebuilt with `course:route` (below), so its corners are rounded to turns a K1 can make (12 m radius; about 10 m round the end of Fry's Island, where there are only 20 m between the island and the bridge) and it keeps 3 m off every bank.

What makes the turns clear (heuristics, chosen to look like a real time trial, not a game):
- **Turning buoys** off the island ends where the course turns or splits (`marks`: big yellow inflatables with a flag, also on both maps).
- **Cues** about 60-100 m before each turn or split (`cues`: an arrow and a line under the clock, "Keep right: up the back channel behind St Mary's Island", "Christchurch Bridge ahead: turn left round the end of Fry's Island").
- The close-up map shows the **real water** (islands as holes) and the **racing line** through it, dashed.
- **Gates** (`gates`): where the course must go through its own water (St Mary's back channel and its end, Fry's main channel, its end, its back channel). Reach one's distance along anywhere else and the game says so ("Missed the course: go back and go round the end of Fry's Island") and won't count a finish until you've gone back for it. Piper's Island has no gate: either arch is fine.
- **Real banks:** on a course file with `water`, boats meet the mapped banks, islands and moored boats (`water.js` `shoreOf`, `sim.js` `bounceOffShore`), not the racing line's open-water edges. That's what made the turns glitchy before: at an island's end the edge dropped tens of metres in a few, and a boat past it was pushed sideways up to 2 m in a frame. Now a push is at most a few tens of centimetres, and other channels (Piper's north arch) are really there. A boat heading into a bank turns along it at 6 rad/s (`BANK_TURN`), not in one frame: at an island's end the bank's direction swings round, and turning in a frame jerked the view up to 78 degrees. Slower than 6 rad/s, boats grind along the bank: at 2.2 rad/s the slowest rival on the Reading course lost two minutes. The water's tree reflections (main.js, from `course.js` `riverView`) are eased too, since they're taken from the open water's width, which jumps at an island's end.

It's a time trial with **interval starts**: boats wait in two columns by the banks below the line and are let go 30 s apart (as shown), you 5th; each is timed from crossing the start line, as in a head race. Your place is by the time everyone's on track for. Most of the route is two-way water, so the AI keeps right there and further right for boats coming the other way; the HUD tells you to keep right.

### Changing a route (`route.ts`, pure `lib/route.ts`, tested)

`course:route <id>` rebuilds a course file's route from `course.json` without the downloads or the footage, from the river line and mapped water already in the file: the legs (`along` the river line between two points, or points to go through), moved off any land, corners rounded to 12 m where there's water for it, the open water either side from the mapped shore; and what's placed along the route: `places` (names found where the file's previous route named them; a label `at` a point; `heading` to name it only on the pass going that way), `birds` (`near` a name, or `at` a point off the line: kept to the real water), `gates` and `cues` (`at` a point, `heading` for the pass), and `marks` (buoys, 4 m out from the nearest shore to `at`). Run it after `course:build` for a course with a route (`course:build` doesn't know these, and skips flocks given `at` a point).

**Rebuilding is reproducible** (checked 2026-10-25): with the cache in `apps/web/.cache/courses/` (the `<rec>/track.json` files and `<id>/river.json`; copy them from the worktree that ran `course:river` if yours has none), `course:build reading` gives the committed file byte for byte, and `course:build loop` then `course:route loop` gives it apart from a place name moving a few metres (route names a place where the previous file's route did, so each run can nudge it). Add new observations at the end of `observations.json`: moorings take random draws in order, so an item added earlier would reshuffle every row after it.

## Adding a course

1. Copy the footage somewhere local, and run `course:ingest <folder>`. Note each recording's number.
2. Write `scripts/courses/data/<id>/course.json`: `name`, `title`, `blurb`, `river` (its OSM name), `from`, `start`, `finish` and `to` as [lat, lng], `recordings`, and `cameraYaw` per recording.
3. Run `course:river <id>` and look at `river.svg`.
4. Run `course:frames <id>`. Check the camera direction first: is the bow ahead in the `-ahead` views? Then go through the left/right contact sheets.
5. Write `observations.json` from what the frames show.
6. Run `course:build <id>`, then add a mode to `MODES` in `games/kayak/main.js` and a menu button in `index.html`. Add the course to the browser cases in `games/tests/browsers.mjs`.
7. Run `course:compare <id>`, tune, and repeat.

## Later: submissions

- **Upload size:** don't upload 10 GB. The browser reads the telemetry stream and cuts frames on the device (WebCodecs), then uploads the track plus a few hundred JPEGs. The GPMF parser is pure TS so that it can run there.
- **Privacy:** frames show people and boat names, so blur faces before anything is stored. Decide whether frames are kept at all, or only the observations.
- **Licence and review:** contributors agree to an open licence for their observations, and a person checks them before they change a course or the river planner. Keep ODbL-derived layers apart from anything meant to be CC0, as the river planner does.
- **Combining:** several videos of the same water confirm (or update) each other's observations. A closed lock or new moorings show up as a change.
- **Camera direction:** estimate it automatically, from optical flow (things stream past on the sides and grow from the middle ahead) or from the sun's position, instead of asking for it.
