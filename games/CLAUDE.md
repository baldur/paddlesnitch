# games/ — browser games at paddlesnitch.com/games

Paddling games that run in the browser. Like `firmware/`, this folder is **not a pnpm workspace package**: no `package.json`, no dependencies, no build step. Every file here is exactly what the browser runs, served as-is from S3.

The kayak game came from `baldur/games.snitchmedia.com` on 2026-10-17, with its history (`git log games/kayak`). This folder is its home now.

## The rules

- **Only native web platform features.** Canvas, WebGPU, Web Audio, Gamepad, Workers, DeviceMotion, Web Speech and so on are all fine. No libraries, no npm, no bundler, no transpiler: ES modules loaded straight from the server.
- **The one exception is WebAssembly.** A game may compile Rust (or C, Zig, …) to `.wasm` where it earns its place (heavy simulation, search, DSP). The source sits next to the committed `.wasm` with a one-line rebuild command, there's no `wasm-bindgen`/`wasm-pack` or generated glue, and it loads with `WebAssembly.instantiateStreaming`.
- **Sounds are generated in code** (`shared/audio.js`), not loaded from files.
- **Phone, keyboard and gamepad** all work.
- **Keep links relative** (`../shared/site.css`) so a game also works from `pnpm games` locally. The one absolute link is the favicon (`/favicon.ico`, the site's own).

## Commands

```sh
pnpm games        # serve games/ on http://localhost:8000 (open /kayak/); ES modules don't load over file://
pnpm games:site   # with `pnpm dev` running: the games under /games/ and the site behind them on one origin, http://localhost:8001/games/kayak/ (sign-in, leaderboards, live races)
node games/tests/live.mjs   # with both of those: two browsers sign up, race each other live, and check the leaderboard and sign-in gate
pnpm test:games   # node --test games/tests/*.test.js (Node's built-in runner); CI runs it on every PR and deploy
pnpm test:games:browsers   # plays each game in Chromium, WebKit and Firefox, desktop + phone, with features removed; add --gpu for real Chrome's GPU
node --test --test-name-pattern="false start" games/tests/*.test.js   # one test by name
```

`pnpm dev` (the Next app) doesn't serve the games; it does serve the `/games` index page.

## How it ships

Merging to `main` ships it. The CDK stack (`DeployGames` in `infra/lib/att-stack.ts`) uploads `games/` (minus `tests/` and `*.md`) to `games/` in the assets bucket, deletes files that were removed, and clears the CDN cache for `/games/*`. Browsers re-check after 5 minutes. A CloudFront Function (`infra/functions/games-router.js`) serves `index.html` for a folder URL, adds the trailing slash a bare folder URL lacks, and sends `/games/` to the `/games` page. `/game` redirects to `/games/kayak/`.

## Every browser, with a fallback for each feature

A game must run in current Chrome, Edge, Safari and Firefox, desktop and phone (iOS 15.4+, the first Safari with `<dialog>`), and anything optional must degrade, never throw. `tests/browsers.mjs` plays each game in all three engines with phone profiles and with features stripped; CI runs it on PRs that touch `games/` (the "games in browsers" check). Phones are emulated there, not real devices.

| Feature | Where it's missing | Fallback |
| --- | --- | --- |
| WebGPU | Firefox, iOS before 26, many Android phones; or it fails to start | WebGL 2 renderer (`kayak/render-gl.js`, loaded only then). `?webgl` forces it |
| WebGL 2 as well | very old browsers | the menu says so and disables the race buttons |
| `<dialog>` | iOS before 15.4 | a plain "too old" message (classic inline script) |
| Gamepad API | Firefox on Android | `navigator.getGamepads?.() ?? []` — never call it bare |
| Motion sensors | desktops; iOS without HTTPS or permission | touch play gets the balance assist |
| Speech | some browsers have none; iOS needs a first word in a tap | on-screen captions for every call; a silent word on the race button |
| Audio start | phones only count the end of a touch as a gesture | `shared/audio.js` unlocks on pointerup/touchend too, and resumes iOS's 'interrupted' state |
| Vibration, full screen, orientation lock | iOS | optional calls (`?.`, `.catch`) |
| Storage | private modes | every read and write in `try` |

The WebGL renderer must look the same as the WebGPU one: `shaders-gl.js` is a line-for-line port of `shaders.js` (keep them in step), with the same 4× MSAA and 24-bit depth, and WebGPU's 0..1 depth stretched to WebGL's -1..1. Without a GPU timer it sizes the resolution from frame times (`pacing.js`, tested): under ~45 fps it drops, a steady ~57+ it creeps back. A lost WebGL context (phones under memory pressure) reloads the page when it comes back.

## Layout

- `<game>/`: one folder per game, with `index.html` loading a `type="module"` entry script.
- `shared/`: what every game uses. Reach for these before writing new plumbing:
  - `site.css`: colour tokens (light/dark via `prefers-color-scheme`) and base styles for buttons, `<kbd>` and `<dialog>`.
  - `game.css`: game page layout (header bar, one `#field` canvas, a `.status` line). Set `--aspect` on `#field` to match the game's field units.
  - `audio.js`: Web Audio synth. `tone({ freq, to, duration, type, gain })` makes every sound. Also holds a mute setting kept in localStorage.
  - `input.js`: `Input` merges keyboard, pointer and Gamepad input into per-player `{ axis, target }`. Also `BUTTON` (standard gamepad indices), `poll()` (buttons newly pressed this frame) and `rumble()`.
  - `canvas.js`: `fitCanvas()` (high-DPI backing plus a transform so you draw in field units), `themeColors()` and `reducedMotion`.
  - `dialogs.js`: `openDialog()`, `gamepadDialogs()` (d-pad and A inside an open `<dialog>`) and `soundToggle()`.
  - `analytics.js`: counts a visit as a `pageview` on the paddlesnitch-app dashboard (same endpoint and session id as the site; only on paddlesnitch.com, never locally).
- `tests/`: Node tests for the pure simulation modules.

## Adding a game

1. Make `games/<slug>/index.html` and its modules.
2. In its `<head>`: `<link rel="icon" href="/favicon.ico">` and `<script src="../shared/analytics.js" defer></script>`.
3. Add it to `GAMES` in `apps/web/src/lib/games.ts` (title, one-line blurb, `href: '/games/<slug>/'`) so it shows on `/games`. `games.test.ts` fails if a folder isn't listed, or a game doesn't count its visits.
4. Put its pure logic in DOM-free modules and test them in `tests/<slug>.test.js`.

Every game covers the same baseline: keyboard, touch and gamepad controls; generated sound with the shared mute toggle; a "← Games" link (`href="../"`) in the header and inside the start menu's `.dialog-links` (a modal `<dialog>` makes the header unclickable).

## Game architecture

Split each game so the simulation can be tested without a browser:

- **Pure modules**: state and maths in fixed units, no DOM. A `step(state, dt, intents)` advances the game and returns event names; the UI turns those into sound and haptics, so the simulation never touches audio.
- **`main.js`**: wires the shared modules together. Input from `shared/input.js` (`poll()` once per animation frame). A rAF loop with a **fixed 1/120 s simulation step** (accumulator), so physics don't depend on refresh rate. Menus, pause and game over are native `<dialog>` elements driven by their `returnValue` in `close` handlers. Auto-pause on `visibilitychange`; respect `prefers-reduced-motion`.

### Kayak

A full-screen WebGPU view with its own renderer (`render.js`, `shaders.js`, `mat4.js`; WebGL 2 fallback in `render-gl.js`, `shaders-gl.js`, `pacing.js`) and procedurally built meshes (`meshes.js`, `world.js`). Its physics (`sim.js`), course geometry (`course.js`) and pack racing (`race.js`: the starter and false starts, rival AI, wash drafting, hull collisions, standings) are DOM-free and tested; a whole race can be simulated headlessly in Node.

Real rivers come from course files (`kayak/courses/<id>.json`, made by `apps/web/scripts/courses`; see `docs/features/game-courses-from-video.md`): `courseFromFile`/`loadCourse` in `course.js`, fetched when first picked, and `world.js` draws their `scenery` (real buildings, styled bridges, moorings, woods, railway, banks by cover) instead of the made-up props. They're true size, so they have a `speedup` (boats move that many times their speed through the world; `sim.js` `move()`) as well as a `warp`, and the HUD's distance is `× warp / speedup`. Course files are ODbL (derived from OpenStreetMap): keep the menu's credit line. They also carry `places` (landmarks named on screen as you pass), `walls` (quays and revetments), `birds` (where swans crowd), `water` (the mapped water's outlines: `world.js` shapes the land from them, so islands and side channels show) and buildings with a `style` drawn as bespoke models (`LANDMARKS` in `world.js`: the Reading rowing and canoe clubs), and get a cloudy sky (`skyTop.w` is cloud cover; 0 on the made-up courses). A course file with a `route` (the Time Trial Loop) races on that line instead of the river line: `courseFromFile` returns the route as the course and the river line as `scenery.river`, which everything in the file is placed along; moored boats narrow the route wherever they lie, and `shared` marks water the route uses both ways (the AI keeps right there). Lining up happens at true speed: `race.js` switches every boat to the course's `speedup` at the horn (or when it's let go), and the pack AI scales its distances (kick, sprint off the line, station-keeping on a wash, look-ahead) by it. `createRace(..., { format: 'interval' })` is a time trial: boats wait in two columns below the line and go 30 s apart (as shown), each timed from crossing the start line; `elapsed()`/`projected()` give a racer's time so far and what they're on track for. Swans and ducks (`birds.js`) are on every course: paddle into a swan and you capsize, ducks fly off; rivals steer round swans.

**Accounts, leaderboards and live races** ([`docs/features/game-accounts-leaderboard-live.md`](../docs/features/game-accounts-leaderboard-live.md)). The game calls the site's tRPC API (`games.*` in `packages/api`, store in `packages/core/src/games.ts`) with plain `fetch` (`kayak/account.js`): it's served from the same origin, so the sign-in cookie comes along. Practice is open to everyone; the races, the leaderboards and live races need an account (signed out, a race button goes to `/signin?next=/games/kayak/`). Served on its own (`pnpm games`, the browser tests) there's no API, so nothing is gated. A finished race posts its time (as shown) to the course's leaderboard; the menu shows the top five. Live races ("Race friends"): one player makes a race and shares `#race=CODE`; browsers find each other through the API's mailbox (S3, polled once a second in the lobby) and then talk directly over WebRTC (`kayak/live.js`: a mesh of up to six, an unreliable channel for boat states 15 times a second, a reliable one for the starter's calls and finishes). The other players are racers with `remote: true` in `race.js`, drawn 100 ms behind their sender between received states (`kayak/net.js`, pure, tested); the host's game runs the starter and the others follow its calls (`applyCall`). No TURN relay: some strict networks can't connect.

Race courses have a `warp`: the HUD shows distances and times 4× longer than what is actually paddled, so a 6 km race (shown as about 28 minutes) plays in about 7, while speeds and stroke rates stay real. Courses vary in width along the way (`widthAt`), and moored narrowboats count as bank. Speed comes from rhythm (a steady alternating beat) as much as stroke rate, and holding the rhythm builds `flow` (up to +6% power over 20 s). Stamina is sprint energy, spent only while the sprint button is held (Shift or Space, gamepad A, a tap-on/tap-off button on phones: `input.sprint`): then strokes pull 20% harder and a beat quicker than `steadyBeat()` (about 91 a minute) counts; otherwise paddling is free and refills it, and a quicker beat pulls no harder than the comfortable one; a wash refills it several times faster. The pack is tuned (`RACE_PACE`, `RIVAL_POWER` in `race.js`) so a person, rarely perfectly on the beat, can race it: the Division 9 winner takes about 31 minutes; hull types (`HULLS` in `sim.js`) trade speed for stability. Session form (stronger, fitter, steadier on the beat after each race) lives in `sessionStorage`. On phones, turning the phone shifts your weight (`controls.js`, DeviceMotion; iOS only allows it over HTTPS, and without it touch play gets a balance assist). The renderer lowers its resolution when the GPU falls behind. Open `kayak/#debug` to expose `window.kayak` (race, boat, location, course, state, GPU stats) for scripted playtests.
