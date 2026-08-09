# Feature spec: Single-app feel — shared UI shell + one dark theme

**Status:** 🚧 building (2026-08-09). **P1 done.**
**Owners:** Baldur (product), Claude (implementation).
**Apps:** both `apps/att` (`/att`) and `apps/analysis` (`/analyse`); new `packages/ui`.

### Progress
- **P1 ✅** `@paddlesnitch/ui` created (`AppShell`, `AccountNav`, `ContactBanner`,
  `FeedbackWidget`, `tokens.css`) — theme-aware, presentational/config-driven,
  per-file subpath exports, `transpilePackages`d. Canonical **dark** tokens in
  `tokens.css` (Tailwind v4 `@theme`, imported by an app's `globals.css` +
  `@source` so the shell's classes get scanned). Adopted in **Analyse**: shared
  `FeedbackWidget` (replaced its own copy), dark tokens, and the `AppShell` header
  on the library page via a thin `AppAccountNav` (→ shared att profile/account,
  one platform account). Analyse builds + 61 tests green. `AccountNav`/
  `ContactBanner` ready for P2.

## Why

att and Analyse currently read as two different products: att is a light data app
with an `AppHeader`/`AuthNav`; Analyse is a dark, immersive app with no shared
header, its own ad-hoc chrome, and a *second* feedback widget. The paddler profile
and the top "customer" banner appear on att only. Goal: make paddlesnitch feel
like **one app** — a shared shell, a consistent profile + banner, one feedback
widget, and **one platform-wide dark theme**.

## Decisions (2026-08-09)

1. **Shared code lives in a new `packages/ui`** — themeable, presentational
   components imported by both apps (not duplicated per app).
2. **Unify all four:** header + account nav · paddler profile entry · contact
   banner · the feedback widget (collapse the two impls into one).
3. **Converge on ONE theme — dark** (extend Analyse's palette platform-wide;
   re-tune all of att). Maps keep dark tiles by default.

## Architecture

### `packages/ui` (new shared package)

- **Presentational + config-driven.** Components take props (the current `user`,
  hrefs, callbacks, the feedback POST path) — they contain **no** app-specific
  routing or data fetching, so both Next apps can use them without coupling to
  `/att` vs `/analyse`. Each app is the thin adapter that supplies data/links.
- Wired like the other packages: per-file subpath `exports`, both apps
  `transpilePackages` it in `next.config.ts`.
- Ships the **shared design tokens** (see Theme) as a CSS file both apps import.

### Components

| Component | Replaces | Notes |
|---|---|---|
| `AppShell` / `AppHeader` | att `AppHeader` + Analyse ad-hoc chrome | breadcrumb slot + **cross-app nav** (Trials ↔ Analyse) + `AccountNav` + feedback trigger |
| `AccountNav` | att `AuthNav` | props: `user`, `profileHref`, `accountHref`, `onSignOut`; signed-out → sign-in link. No hardcoded `/att` paths. |
| `ContactBanner` | att `StravaContactBanner` | props-driven (show?, dismiss cookie key, contact href); shown on BOTH apps |
| `FeedbackWidget` | att `FeedbackTrigger` + Analyse `FeedbackWidget` | ONE component, POSTs to `/att/api/feedback` (shared origin), anti-bot fields, theme-aware |

### Data/routing seam
- Auth: att reads `/att/api/auth/me`, Analyse reads `/analyse/api/me` — each app
  fetches its own `user` and passes it to `AccountNav`. (Optionally later: a
  shared `/api/me`.)
- Shared logic moves to `@paddlesnitch/core`: `isSyntheticStravaEmail` +
  contact-email check (today in att's `strava-account.ts`) so the banner can be
  driven identically from both apps.
- Sign-out, profile, account hrefs are passed in per app.

## Theme convergence → dark

att already defines semantic tokens in `globals.css` (`@theme inline`:
`--color-bg`, `--color-surface`, `--color-fg`, `--color-border`, `--color-muted`,
`--color-primary`, …) — **but ~32 of 45 att `.tsx` files use hardcoded hex**
(`bg-[#ffffff]`, `border-[#e2e8f0]`, `text-[#0f172a]`) instead of token classes.
Analyse likewise hardcodes dark hex (`bg-[#0b1220]`, `text-[#e2e8f0]`). So the
convergence is three moves:

1. **Define ONE shared semantic token set (dark)** in `packages/ui` (light values
   retained as reference / optional future mode). Both apps' `globals.css` import
   it and map the `@theme` tokens to it.
2. **Migrate hardcoded hex → semantic token classes** in both apps
   (`bg-[#ffffff]` → `bg-bg`, `border-[#e2e8f0]` → `border-border`,
   `text-[#0f172a]` → `text-fg`, etc.). This is the bulk of the work (~32 att
   files + Analyse's components) and is mechanical but wide.
3. **Flip the token values to the dark palette** — once components use tokens,
   this is a small change; the whole platform goes dark at once.

Dark palette (from Analyse): `bg #0b1220`, `surface #0f172a`, `border #1e293b`,
`fg #e2e8f0`, `muted #64748b/#94a3b8`, accent `#0369a1`, plus the existing
green/red/split accents re-checked for contrast on dark.

**Maps:** att maps currently default to light (CartoDB Voyager) with a dark
toggle; flip the default to dark (`dark_all`) to match, keeping the toggle.

## Phasing (each phase shippable)

- **P1 — scaffold `packages/ui` + shared dark tokens + one FeedbackWidget.**
  Adopt in **Analyse first** (already dark → lowest risk): replace its ad-hoc
  chrome with `AppShell`/`AccountNav` and the shared `FeedbackWidget`. Proves the
  shell end-to-end.
- **P2 — adopt the shell in att** (header/nav/banner/feedback) while att is still
  light (shell is theme-aware). Move `isSyntheticStravaEmail`/contact check to
  core; show `ContactBanner` on both apps.
- **P3 — token migration in att**: convert the ~32 hardcoded-hex files to token
  classes, page-group by page-group (leaderboard → forms → admin → auth → profile
  → groups → account → maps), keeping att light throughout (no visual change yet).
- **P4 — flip to dark**: switch the shared token values to the dark palette;
  re-check contrast, map default → dark, fix any stragglers. Platform goes dark.
- **P5 — cross-app polish**: Trials ↔ Analyse nav, unified paddler-profile entry
  (and optionally surface Analyse paddles on the profile), consistent loading/empty
  states.

## Risks / notes

- **Wide surface.** att is ~45 `.tsx`, 32 with hardcoded hex; Analyse adds more.
  The migration (P3) is the long pole — mechanical but touches almost everything.
  Do it token-first so P4's flip is trivial and reviewable.
- **Contrast + accents on dark**: the split (`#6d28d9`) / green / red accents need
  a contrast pass on `#0b1220`.
- **Tests/e2e**: check for any test asserting on light hex/classes; update as the
  migration lands (behaviour unchanged, only classes).
- **Screenshots/docs**: the design-system section in CLAUDE.md becomes dark — update it in P4.
- **No data/behaviour change** — this is chrome + styling only; permission, auth,
  and API surfaces are untouched.

## Open questions
- [ ] Profile depth — just a **consistent entry point** to `/att/u/{id}` from both
      apps (v1), or a true **platform profile** that also shows Analyse paddles (later)?
- [ ] A single shared `/api/me` vs each app keeping its own (v1: keep each app's).
- [ ] Keep a light mode as a user toggle later, or dark-only?
