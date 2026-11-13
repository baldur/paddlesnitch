# Game courses from 360 video

✅ Shipped 2026-10-24: **Reading Thames**, Christchurch Bridge to Mapledurham, and the **Time Trial Loop**, the canoe club's loop round St Mary's and Fry's islands, in the kayak game (`/games/reading-thames/`). Since 2026-10-30 Reading Thames is the **world** every course is raced on: the Time Trial Loop, **Hasler Div 7-9**, **Hasler Div 1-6** (with a portage at Mapledurham) and **Practice** (see [One river, many courses](#one-river-many-courses)).

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
| 4. Observations | by hand (for now); `course:look` is gathering material for it | the frames | `data/<id>/observations.json` (committed) |
| 5. Course file | `course:build <id>` | river + observations | `games/reading-thames/courses/<id>.json` (committed, shipped with the game) |
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
- `moorings`, with `boats`: `cruiser`, `narrowboat`, `trip-boat`, `tatty` (tired old cruisers: tarps, faded paint, flags) or `mixed`. With `length` it's one boat, as seen: `paint` (`maroon`, `navy`) and `crew` (`statues`: the Lara Croft figures; `tower`: a wakeboard boat's tower; `fenders`: blue fenders over the side); `boats: 'houseboat'` for a big timber one; `exact: true` moors it where `at` is, along `heading` (a side channel the river line doesn't follow).
- `buildings`, with `style`: `flats` (made tall) or `clapboard` (white and grey board houses with decks and jetties), for the OSM buildings on that side of the stretch. A `landmark` with `style: 'stilts'` marks one building as flats on concrete stilts over the water; `tudor-boathouse` is the half-timbered boathouse at 1.7 km.
- `bridge`, with `style` (`cable-stayed` or `concrete-arch`) and `mast`.
- `railway`.
- `wall`: a quay or revetment at the water's edge; `style: 'brick'` for a tall brick wall straight out of the water (under the railway below Mapledurham).
- `feature`, with `style` and `at` (a point on the bank, not the camera): a thing seen in the footage with its own model (`FEATURES` in `world.js`), built at that point facing the water: `beach`, `landing` (a little beach), `sandbags`, `channel-sign`, `mailbox`, `gazebo`, `sculling-club`, `glass-restaurant`, `ferry-landing`, `marina`, `willow`, `wharf`, `jetty`. Other trees keep off it (`CLEAR`).
- `path`, with `points`: a footpath along the bank (a portage's run). Drawn as gravel; trees keep off it.
- `landmark`, with `style`: an unnamed building to draw as a bespoke model, given by a point beside it (`at`): the nearest OSM footprint within 40 m gets the style. Named buildings use `styles` in `course.json` instead.
- `posts`, with `points` (lat/lng each): posts standing in the water. Solid in the game.
- `anglers`, with `count` and a stretch (`from`/`to`, `side`): people fishing from that bank, spread along it.

**Owner's spots (2026-10-25).** The owner gave GPS points for things to make more recognisable. Finding them in the footage: take each recording's `track.json` (from `course:ingest`), find the fixes within ~40 m of the point, one per pass, and pull flat views from the 360 at that moment towards the point (ffmpeg `v360` as `frames.ts` does, a narrow `h_fov` to zoom). From those came the posts off St Mary's Island, the riverside villa, the spiral-stair and grey boathouses, the canoe club's details, the tatty cruisers below Caversham Bridge and the anglers on the Promenade.

**Owner's spots (2026-10-30).** Eleven more points, from Christchurch Bridge to the portage, plus a boat found in the pair footage (`Raw/pair/GS030094.360` at 6:33): the glass house and its willow, the marina at Riverside Park, the railway's brick wall with its red "mailbox", the gazebo and cruiser opposite, the Lara Croft narrowboat, the clapboard houses below Mapledurham, the beach and CHANNEL sign, the sandbag put-in, the sculling club by Christchurch Meadows, the glass restaurant and the ferry landing at the Village Hotel. Most pins were dropped on the water: walk from the pin across the mapped water to the bank on the named side (or the nearer one) for the thing's `at`, and check the side three ways (the owner's words, which way the pass was heading, and what OSM has there: a trailer park, the railway embankment, the hotel). A pass's left and right are the camera's: the kayak trips went down first round Caversham Bridge, so there "pass 0" is the downstream one. The review page every 100 m (footage over the game, four ways, with notes and a comment per spot) is built from `course:frames reading --step 100` and game screenshots taken with `#debug` at the frames' fixes.

A course can use another's observations (`observations` in `course.json`): the Time Trial Loop uses Reading's, placed on its own river line.

**Pitfall: a pass up a different channel.** An observation is placed where the *camera* was and projected onto the course line. If the camera was in another channel round an island, the side comes out wrong: a row of cruisers on the island's far side ended up on the course's left at Fry's Island. Label from a pass that follows the course's own channel, or (better, for the vision-model step) record where the *thing* is rather than the camera.

Because they're geo-referenced, the same observations can feed another course on overlapping water, or the river planner (moorings, landing stages, locks). For Reading they were labelled by Claude from frames every 100 m. The next step is a vision model labelling frames (Bedrock, as the Analyse insights do), with a person checking.

### 5. Course file (`build.ts`, pure `lib/course-file.ts`, tested)

Combines the river and the observations into what the game draws:

- `line` and `width`: a running median takes out spikes where a ray slipped into a side stream, clamped to 20–100 m.
- `banks` (cover per stretch), `walls`, `moorings` (rows of boats filling each observed stretch), `bridges` (one per crossing cluster, under the bridge's own OSM name, styled from the observations, with `ends`: the longest road over it, so a bridge crossing at a slant is drawn along its road; Caversham Bridge spans both channels round Piper's Island at about 70 degrees, and drawn square across the river line it stood 40 m off in the north channel), `features` (see `feature` above).
- `places`: the landmarks named on screen as you pass them, from the course's `places` list of OSM names (optionally relabelled, or `{ label, at }` for a point of your own) in `course.json`. On the river line each is named where the line comes nearest; on a route, once each time the route goes by, as you come up to it.
- `birds`: where swans crowd (`{ near: <OSM name>, count, spread }`).
- `styles`: OSM building names drawn as bespoke models (`rowing-club`, `canoe-club`), modelled from the frames; `landmark` observations add more by position (`spiral-boathouse`, `grey-boathouse`, `riverside-villa`).
- `posts` (x, z each) and `anglers` (`{ s, side }` on the river line), from those observations.
- `water`, and `route` (its line every 5 m and the open water each side, smoothed per side).
- OSM `buildings` (footprints with heights; `building:levels` when mapped), `woods`, single `trees`, `railways`, `locks` and `weirs`.

The file carries `credit` and `licence`. **It's derived from OSM, so it is an ODbL database.** The game's menu credits OpenStreetMap.

### 6. Review (`compare.ts`)

Serves `games/`, plays the course in Chrome with `#debug`, puts the boat at each spot, and screenshots it next to the real frame. This is how the tree density and size were tuned: the first version's banks were thin and low, while the real Thames is lined with 10–20 m trees and scrub over the water.

### Looking with a local model (`look.ts`, pure parts in `lib/look.ts`, `lib/stations.ts`, `lib/eac.ts`, tested)

Started 2026-11-12 (owner: "lots and lots of details", stop and resume, data always available). A vision model on this laptop (Ollama, `qwen2.5vl:32b` by default) looks at **all** the 360 footage it can find and writes down what's along the river, place by place. It's independent of any course: it works per clip, and everything it records has a place, so any course (or the river planner) can use it later.

```
pnpm --filter web course:look [folders…]   # find *.360 under the folders (default ~/Movies), then look until stopped
                                           #   --model, --levels 4, --minutes, --scan, --base (new store only)
pnpm --filter web course:look --status     # progress per clip and level, time left
pnpm --filter web course:look --export     # everything seen, placed, as GeoJSON
```

- **Finding footage:** every `*.360` under the folders. Clips without GPS are listed and skipped; symlinks, hidden folders and photo or Final Cut libraries aren't searched. Each clip's own size gives its cube-face layout (`eacLayout`): the 2026-08 Reading clips are 4096×1344 (32 px overlap), the newer ones 3008×960 (64 px). `course:frames` uses the same layout code.
- **Coarse to fine:** spots are every 100 m *travelled* (moves under 3 m from the last counted point are GPS scatter and don't count), then the 50, 25 and 12.5 m points between them (`--base`, `--levels`). All footage is done at one level before the next, so the whole river is covered early and detail grows as long as it runs.
- **Each spot:** four 100°-wide views round the lens (they overlap), each asked the same questions (`PROMPT`) with the answer held to a JSON schema (`SCHEMA`): a sentence on the scene, water and light, whether the boat's own paddler is in view (back or face, paddle or oars), and up to 30 items, each a `kind` from a fixed list that matches the observation kinds, a short `detail`, where it is across the picture, a distance band and a count. Items it says it didn't see are dropped, and repeats are merged (`parseLook`).
- **Which way the camera faced** isn't needed to look, only to place. Answers are stored against the lens angle. The camera's direction comes from the answers (`decideCameraYaw`: a paddler faces the bow, a rower the stern; 3 views agreeing, 3 in 4 of the votes) or from `cameras.json` in the store, and is applied when exporting, so a wrong guess wastes no model time.
- **Placing:** an item's bearing is the boat's heading (GPS, over 10 m either side) plus its angle from the bow (its position across the view); it's put 8, 30 or 80 m out for near, mid and far (`placeItem`). Rough on purpose: the banks' true positions still come from OSM.
- **Stopping and resuming:** Ctrl+C finishes the spot (or, while scanning, the clip) and stops; a second Ctrl+C a moment later stops at once, and that spot is redone. ffmpeg and ffprobe run in their own process group (`lib/proc.ts`) so the terminal's Ctrl+C reaches only course:look. Each view's answer is saved as it comes. Run it again and it carries on. Every scan makes sure every clip has every spot for `--levels`, so raising it later, or a scan cut short, is completed. A clip is known by its first fix time and size, so a moved or renamed clip keeps its looks, and a second copy is skipped; a clip whose track changed (scanned mid-copy) starts again. The spot spacing (`--base`) is fixed per store. One scan or look run per store at a time (`look.lock`; a lock left by a process that's gone is taken over).
- **Failures:** Ollama down, a model that isn't pulled, an HTTP error, an error mid-reply or a reply over 10 minutes stops the run with a one-line message and records nothing (Ollama is checked before the scan). Run it again to carry on. A reply that isn't a look after two tries is kept (`ok = 0`) and not retried; `--status` counts them. A stretch of video ffmpeg can't cut is skipped for that run.
- **Versions:** changing the prompt or schema bumps `PROMPT_VERSION`. Looks are kept per model and version, so a new model or prompt starts afresh beside the old ones.
- **Speed (M5 Max, 128 GB):** 20 to 100 s a view (a long list takes longer), 2 to 3 minutes a spot.

**Privacy.** The frames show other people, their boats and houses; the store holds the owner's tracks and times. So:

- Frames only go to a model on this machine: the endpoint (`PADDLESNITCH_OLLAMA`, default `localhost:11434`; not `OLLAMA_HOST`, which is often set for other reasons) must be loopback unless `--allow-remote`, and Ollama's cloud models are refused, by name and, for one copied to another name, by its details (`remote_host`). Only the image, the prompt and the schema are sent.
- The store is a SQLite file outside the repo: `~/.paddlesnitch/footage/footage.db` (`PADDLESNITCH_FOOTAGE` moves it), tables `chapters` (with each clip's track), `stations`, `looks` (with the raw reply), `items`, and `areas` and `landmarks` for the careful look. Open it with `sqlite3` or anything else. The store and `--export` refuse any path inside a git work tree (following symlinks). They can't see synced folders: don't point either into iCloud Drive or a Documents folder that syncs. **The export is personal data too**: its points and bearings trace the paddles. Neither goes in the repo, an issue or a chat.
- course:look keeps no frames: each spot's views are cut to a temp folder and removed (also on a hard stop). Any spot can be cut again from the clip. course:explore keeps the views it shows in the store's `views/` folder (outside the repo, like the store; the browser doesn't keep them). They show people and boats like the frames do, and backups such as Time Machine copy them: delete the folder when you're done checking.
- The model is asked not to name boats or describe who people are, but that's a request, not a guarantee: `detail`, `scene` and `raw` stay in the store.

### Checking what it saw (`explore.ts`, page `lib/explore-page.ts`, pure parts in `lib/explore.ts`, tested)

Added 2026-11-12 so the owner can judge the model before anything it saw goes into the game.

```
pnpm --filter web course:explore [--port 3201] [--model qwen2.5vl:32b]   # then open http://localhost:3201
```

River Explorer is a small local web page over the store. It can run while course:look is looking.

- **Map:** every spot looked at, over the clips' tracks: green once every pin on it is marked, grey when there was nothing to mark.
- **A spot:** its four views with the bow in the middle: left, ahead, right, behind (`stripOrder`, using the clip's camera direction or the usual back-deck one). That's one row on a wide screen and two rows that fit the window on a laptop. The model's things are pinned where it said they were: across by `x`, down by distance band, laid out for the picture's size on screen so labels don't overlap (`layoutPins`). Its sentence is under each view. The views are the ones the model was shown, cut when first opened; the next spots are cut while you look.
- **Marking:** click a pin if it's right; right-click or shift-click if it's made up; the same again clears it. On a focused pin, `r`, `x` and `0` do the same. Click the picture where the model missed something, pick its kind and press Enter (Escape cancels). Keys: ← → along the clip, `n` the next spot with unmarked pins, Shift+A marks the rest of this spot right.
- **Score:** the share of marked pins that were right, how many were made up and how many things it missed, and right out of marked for each kind (`scoreOf`). This is the spot-check that decides whether the model is good enough to feed the game, and which kinds to trust.
- **The same place on other days:** the nearest spot from each clip filmed on another date, within 30 m (`otherPasses`), to see whether the model agrees with itself. Another chapter of the same paddle doesn't count.
- **Stored** in the store's `reviews` (one verdict per item) and `missed` tables. Redoing a look, or a clip that changed, drops its verdicts with its items, and ids are never reused (`AUTOINCREMENT`; an older store is upgraded when opened), so a verdict never scores a different answer and a cached picture never shows a different spot.
- **Local only:** the server listens only on 127.0.0.1 and answers only a `Host` of localhost or 127.0.0.1 on its port, so another site can't reach it through a name pointed at 127.0.0.1. The data and pictures are sent only to its own page (`Sec-Fetch-Site: same-origin`, `Cross-Origin-Resource-Policy`), so another site's page can't even make it cut pictures. Changes are taken only as JSON from its own page (`Origin`). The page runs only its own script (a CSP with that script's hash), loads nothing from elsewhere, and shows the model's words as text, never HTML. Errors name no paths; the detail goes to the terminal.

### Looking carefully in an area (`course:look --areas`, pure parts in `lib/landmarks.ts`, tested)

Added 2026-11-13. The general look was too vague and made things up (owner: too vague to use): moored narrowboats called boathouses, railways that aren't there. The owner wanted to choose the places himself and have the model look hard for what identifies them.

```
pnpm --filter web course:explore              # drag on the map to draw an area (scroll to zoom in first; "Bigger map" helps)
pnpm --filter web course:look --areas         # look carefully inside the areas, until stopped (--minutes, --levels as usual)
pnpm --filter web course:look --status --areas
```

- **Areas** are rectangles drawn on River Explorer's map, named, and kept in the store's `areas` table. Zoom with the scroll wheel, Shift-drag to move a zoomed map. Before saving, the page shows how many spots the area holds and roughly how long it will take, and warns above 10 hours. A 100 to 300 m stretch is the right size: about 20–60 min a pass, hours for every pass.
- **Only inside areas, one at a time:** every spot inside an area (every 25 m with the default 100 m base, `AREA_LEVELS`; `--levels` overrides). Areas are done in the order they were drawn, and within an area one clip's pass is finished before the next starts, so the first full set of answers comes quickly and the other days add to it.
- **Closer views:** eight 60°-wide views instead of four 100° ones: about twice the pixels on each thing. About 5 minutes a spot with `qwen2.5vl:32b`.
- **A narrower question** (`LANDMARK_PROMPT`): only fixed things the place could be recognised by (distinctive buildings, bridges, locks, boathouses, pubs, signs with readable text, unusual moorings or trees), each with a short name, a kind from its own short list of fixed things (`LANDMARK_KINDS`: no boats, people or animals, so they can't be filed here), a detail of colours, materials and a sign's text, its box in the picture, a distance band and whether the model is sure. It's told to leave out all boats (a moored boat is not a boathouse) and not to call a bridge a railway bridge without seeing track; an empty answer is fine. Answers are checked by `parseLandmarks` (boxes put the right way round and clamped; a box given in pixels, as Qwen2.5-VL often does, is scaled from the 1024×640 picture; unusable ones dropped) and stored as looks with `LANDMARK_VERSION` (apart from the general `PROMPT_VERSION`) with the things in the `landmarks` table. In the first trial the model read a club's sign correctly, but still listed ordinary trees and called almost everything sure: treat a find as a lead to check in the picture.
- **In River Explorer** an area shows each thing found on the closer view it was seen in, boxed, with its name, detail, whether the model was sure, and the clip, day and time; it's placed on the map from the box's centre (`placeItem` with the 60° width). Sure ones come first. Removing an area keeps what was found.
- **Satellite imagery** under the map (Esri World Imagery, keyless, as the site's maps use; `tilesFor` picks tiles sharp enough for the screen, at most 80) makes the river findable; the CSP allows images from `server.arcgisonline.com` and nothing else. Esri sees which tiles are asked for, so which part of the river is viewed, never the tracks, footage or finds; the page sends no referrer. The Satellite button turns it off.
- Privacy is as above. course:look keeps no frames; course:explore cuts the closer views into `views/` too (`<spot>-l<angle>.jpg`).

### Footage here: reference pictures for the game's look (River Explorer, pure parts in `lib/here.ts`, tested)

Added 2026-11-13. The owner doesn't want things named; he wants the game to look more and more like the real river. That needs the real pictures of a place, so this uses no model at all.

- **Pick a point:** press **Footage here** under the map, then click the river (a click within 10 px of a track lands on it; the map zooms in to show the circle). Choose within 10, 20 or 30 m. The page keeps picking until the button is pressed again.
- **Every pass:** each time a clip's track came within the radius (`passesNear`: a run of fixes inside the circle, split where the camera was off for over 30 s), at its closest moment. A pass that crosses a chapter boundary is found in both chapters and kept once (`oneAcrossChapters`). Listed in the order filmed, with day and time of day (the light matters), up to the closest 40. Their spots show on the map.
- **The pictures:** left, ahead, right and behind as 90° views, 1536×960 (about the camera's own sharpness), and **Whole 360**: the whole sphere as a 4096×2048 equirectangular picture with ahead in the middle, usable as a panorama or environment map. Best JPEG quality. ‹ 2 s and 2 s › step along the clip. Click a picture to open it full size and save it.
- **Cut** on first view by ffmpeg (all five of a moment at once, two moments at a time at most) into `views/here/<clip>-<tenths of a second>-<view>.jpg`. Delete `views/` to remove them all.
- Privacy is as above: same localhost-only server, routes `/api/near` (only the offered radii) and `/here/<clip>/<tenths>/<view>.jpg` (whole numbers only, inside the clip's length). The pictures are the owner's footage: they stay on this machine and never go in the repo; whatever the game uses is made from them (textures, colours), not the frames themselves, unless the owner decides otherwise.

**Into the game (next).** A separate step will merge items across passes and clips (seen on most passes at a place: scenery; seen sometimes: a spawn rate) into `observations.json` and the course files. **What it may commit is an allowlist:** a `kind` from `KINDS`, an aggregated count or rate, and a position merged across passes: only places seen on at least 3 passes on at least 2 different days, snapped to the river line (distance along it, every 25 m) and a side, never raw latitude and longitude. Never `detail`, `scene`, `raw`, a landmark's `name`, `detail` or box, clip names, times (`ft`, `start_utc`), dates, or anything per pass. Its output gets a test that rejects any other key, and the `security-privacy` reviewer checks it before anything derived from the store is committed.

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

**Rebuilding is reproducible** (checked 2026-10-25): with the cache in `apps/web/.cache/courses/` (the `<rec>/track.json` files and `<id>/river.json`; copy them from the worktree that ran `course:river` if yours has none), `course:build reading` gives the committed file byte for byte (checked again 2026-10-30, when only the new `paths` changed), and `course:route <id>` rebuilds each course on it (`loop`, `hasler79`, `hasler16`, `practice`) from the world and its `course.json` alone: run them all after rebuilding the world. Add new observations at the end of `observations.json`: moorings take random draws in order, so an item added earlier would reshuffle every row after it.

## One river, many courses

Owner's choice, 2026-10-30: the courses differ, the river doesn't. `reading.json` (built by `course:build reading`) is the world. Every other course's `course.json` says `"world": "reading"` and gives only its route and what goes along it, and `course:route <id>` writes `games/reading-thames/courses/<id>.json` as the world's file with that route (and `world: 'reading'`, which the game uses to build the river once for all of them). The game's `kayak-courses.test.js` checks the scenery is identical in every file.

- **Hasler Div 7-9** (7.9 km): from the canoe club up the main channel, keeping right of Appletree Eyot, round its upstream end and down its back channel (a gate there), down past the club, keep right of Piper's Island (the south arch), down the right of Fry's Island, round its end before Christchurch Bridge, up its back channel, keep right of Piper's going up (its narrow north channel, by the Reading University boathouses: a gate and a buoy), and home to the club. Appletree Eyot is the lower of the two islands (Poplar Island is just above it).
- **Hasler Div 1-6** (12.6 km): up to Mapledurham, keeping to the main channel; land on the beach on the left (the owner's point 51.48366, -1.03732), run about 160 m down the bank path, put in from a little beach behind the island (51.48245, -1.03733), about 10 m up from the sandbag wall (owner, 2026-10-31: the wall blocks the water at the old put-in), down its back channel, then as Div 7-9 from the club. Raced against a quicker pack (`DIVISION_3`).
- **Practice**: 1 km up from the club.

The start and the finish are both at the club: `course:route` puts the start on the route's first pass by its point and the finish on the last. **A portage** is a leg `{ "portage": [points on land] }` between the leg that ends where you land and the one that starts where you put in: each stretch of water is moved off the land and smoothed on its own, and the run joins them as given (`joinRuns` in `lib/route.ts`, tested). The file gets `route.portages: [{ from, to }]` and the run's open water is 1 m each side. Give the run the same points as the world's `path` observation, so it follows the gravel path the trees keep off.

## Adding a course

1. Copy the footage somewhere local, and run `course:ingest <folder>`. Note each recording's number.
2. Write `scripts/courses/data/<id>/course.json`: `name`, `title`, `blurb`, `river` (its OSM name), `from`, `start`, `finish` and `to` as [lat, lng], `recordings`, and `cameraYaw` per recording.
3. Run `course:river <id>` and look at `river.svg`.
4. Run `course:frames <id>`. Check the camera direction first: is the bow ahead in the `-ahead` views? Then go through the left/right contact sheets.
5. Write `observations.json` from what the frames show.
6. Run `course:build <id>`, then add a mode to `MODES` in `games/reading-thames/main.js` and a menu button in `index.html`. Add the course to the browser cases in `games/tests/browsers.mjs`.
7. Run `course:compare <id>`, tune, and repeat.

## Later: submissions

- **Upload size:** don't upload 10 GB. The browser reads the telemetry stream and cuts frames on the device (WebCodecs), then uploads the track plus a few hundred JPEGs. The GPMF parser is pure TS so that it can run there.
- **Privacy:** frames show people and boat names, so blur faces before anything is stored. Decide whether frames are kept at all, or only the observations.
- **Licence and review:** contributors agree to an open licence for their observations, and a person checks them before they change a course or the river planner. Keep ODbL-derived layers apart from anything meant to be CC0, as the river planner does.
- **Combining:** several videos of the same water confirm (or update) each other's observations. A closed lock or new moorings show up as a change.
- **Camera direction:** estimate it automatically, from optical flow (things stream past on the sides and grow from the middle ahead) or from the sun's position, instead of asking for it.
