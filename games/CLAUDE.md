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
pnpm test:games   # node --test games/tests/*.test.js (Node's built-in runner); CI runs it on every PR and deploy
node --test --test-name-pattern="false start" games/tests/*.test.js   # one test by name
```

`pnpm dev` (the Next app) doesn't serve the games; it does serve the `/games` index page.

## How it ships

Merging to `main` ships it. The CDK stack (`DeployGames` in `infra/lib/att-stack.ts`) uploads `games/` (minus `tests/` and `*.md`) to `games/` in the assets bucket, deletes files that were removed, and clears the CDN cache for `/games/*`. Browsers re-check after 5 minutes. A CloudFront Function (`infra/functions/games-router.js`) serves `index.html` for a folder URL, adds the trailing slash a bare folder URL lacks, and sends `/games/` to the `/games` page. `/game` redirects to `/games/kayak/`.

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

A full-screen WebGPU view with its own renderer (`render.js`, `shaders.js`, `mat4.js`) and procedurally built meshes (`meshes.js`, `world.js`). Its physics (`sim.js`), course geometry (`course.js`) and pack racing (`race.js`: the starter and false starts, rival AI, wash drafting, hull collisions, standings) are DOM-free and tested; a whole race can be simulated headlessly in Node.

Race courses have a `warp`: the HUD shows distances and times 4× longer than what is actually paddled, so a 6 km race (shown as about 28 minutes) plays in about 7, while speeds and stroke rates stay real. Courses vary in width along the way (`widthAt`), and moored narrowboats count as bank. Speed comes from rhythm (a steady alternating beat) as much as stroke rate; hull types (`HULLS` in `sim.js`) trade speed for stability. Session form (stronger, fitter, steadier on the beat after each race) lives in `sessionStorage`. On phones, turning the phone shifts your weight (`controls.js`, DeviceMotion; iOS only allows it over HTTPS, and without it touch play gets a balance assist). The renderer lowers its resolution when the GPU falls behind. Open `kayak/#debug` to expose `window.kayak` (race, boat, location, course, state, GPU stats) for scripted playtests.
