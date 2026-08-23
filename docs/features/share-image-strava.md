# Feature: share-card image + Strava share helper (#212)

**Status:** 🚧 spec (2026-08-23). Decisions locked. Builds on the opt-in public
share link (#202/#203).
**App:** `apps/analysis`.

## Goal

When a paddler shares a paddle, make the link **attractive** — it should unfurl
with a branded card on social, and (for Strava-sourced paddles) make it easy to
put the paddlesnitch link + a nice image onto their Strava activity, to draw
other paddlers/rowers to the app.

## Decisions (chosen with the owner 2026-08-23)

- **Stay read-only on Strava — no new scope.** No `activity:write`. The Strava
  step is a **no-scope helper** the user completes themselves (paste link, add
  photo) — no forced re-auth, no trust cost.
- Hangs off the **existing** share-link generation (#202) — additive, not a new
  sharing model.

## Hard constraints (Strava API — do not design around these)

- **No photo attach via API.** Strava's public write API has no endpoint to add
  a photo to an existing activity. Any image on the Strava side is the user
  adding it **manually** in Strava's app. This is not a scope issue — the
  capability doesn't exist.
- **Strava's feed doesn't unfurl link previews.** A link in an activity
  description won't render the card image inside Strava. The card's reach is:
  (a) the user manually adding it as a Strava **photo**, and (b) link **unfurls
  on social / chat** (WhatsApp, iMessage, X, etc.), where OG previews work.
- **The shared page is a client component** (`shared/[shareId]/page.tsx` fetches
  JSON), so crawlers see no preview from it. The OG tags + image must come from
  Next's **`opengraph-image` route convention**, which is server-rendered and
  attached to the route segment regardless of the page being client-side.

## Design

### The share card (OG image)

`app/analyse/shared/[shareId]/opengraph-image.tsx` — a server `ImageResponse`
(`next/og`, Node runtime). It:

- `getSharedSession(shareId)`; if it's missing/revoked → a generic branded
  fallback card (never 500, never leak).
- Renders (1200×630): brand-dark background, the **route as an SVG polyline**
  (normalise `result.points` lat/lng into the viewbox, embed as an `<img>` data
  URI — Satori renders inline SVG unreliably, a data-URI `<img>` is safe),
  headline stats (**distance, duration, pace/500, avg stroke rate**), the paddle
  **date**, a **sport** tag when known, and the **paddlesnitch** wordmark. No
  athlete name / no PII on the card.
- Next auto-injects `og:image` + `twitter:image` for the shared route from this
  file. `twitter-image.tsx` re-exports it.

Pure helpers (so they're unit-testable without rendering): a `shareCard(session)`
that returns the formatted stat strings + the normalised polyline points. The
`ImageResponse` layout consumes that.

### Download + Strava helper (owner's SHARE panel)

In `AnalysisView`'s SHARE panel (owner view; `sessionId` present), once a link
exists:

- **DOWNLOAD IMAGE** — fetches the card at `/analyse/shared/{shareId}/opengraph-image`
  and saves it, so the user can add it as a Strava photo (or post anywhere).
- **Strava block, only when `source.type === 'strava'`** (the owner's session
  carries `source.stravaActivityId`): an **"Add to your Strava activity ↗"**
  deep link to `https://www.strava.com/activities/{id}`, plus copy-link +
  download-image, and a one-line nudge: *"paste the link into your activity's
  description and add the image as a photo."* No API calls to Strava.

The public shared page currently strips `source` down to `{ type }` — that's
fine; the Strava helper is **owner-side only** (the public viewer doesn't need
it), and the owner's session has the full `source`.

## Privacy

The card derives only from an **already-public** shared session (a valid
`shareId`); a revoked link renders the generic fallback. No new data is exposed
beyond what the public shared page already shows, and the card carries **no
name/PII** — just route shape + aggregate stats + brand.

## Phasing

- **P1 — the share card.** `opengraph-image` route + `shareCard` helper +
  DOWNLOAD IMAGE in the SHARE panel + `twitter-image`. Delivers the social
  unfurl + the downloadable photo for everyone (not just Strava).
- **P2 — Strava helper block** in the SHARE panel (deep link + nudge), shown for
  Strava-sourced paddles.
- **P3 — (deferred, optional)** `activity:write` auto-append of the link to the
  Strava description. Separate decision; needs broader scope + re-auth.

## Testing

- Unit: `shareCard` — stat formatting (distance/duration/pace/spm/date), sport
  label, and route-polyline normalisation (bounds → viewbox, empty/one-point
  guards).
- Route smoke: `opengraph-image` returns a 200 PNG for a valid shareId and the
  branded fallback for an unknown one (never throws).
- Component: the SHARE panel shows DOWNLOAD IMAGE when shared, and the Strava
  block only for `source.type === 'strava'`.

## Infra

None new. `opengraph-image` runs in the existing analysis Lambda (Node runtime).
`next/og` (Satori) adds some bundle weight — acceptable; watch the analysis
server bundle size on build.
