# Feature: platform profile + account routes

**Status:** 🚧 built, in review (2026-08-09).
**Owner:** Baldur (product), Claude (implementation). App: `apps/att` (served at the platform root).

## Why

Profile + account lived under att's prefix (`/att/u/{id}`, `/att/account`) and its
API under `/att/api/account/*`. As part of the single-app-feel work, they move to
**platform-level** routes so both apps link to one consistent place.

## Scheme (chosen 2026-08-09)

| Purpose | New URL | Was |
|---|---|---|
| Someone's public profile | `/profile/<id-or-handle>` | `/att/u/<id>` |
| Your own profile (entry) | `/profile/me` → redirects to `/profile/<your-handle-or-id>` | — |
| Your account settings | `/profile/me/settings` | `/att/account` |
| Account API | `/api/account/*` | `/att/api/account/*` |

- **`/profile/me`** resolves the signed-in user and redirects to their canonical
  public profile (`/profile/{handle ?? id}`); signed-out → `/att/auth?next=/profile/me`.
  The public-profile page shows a **SETTINGS** link (→ `/profile/me/settings`) and
  the "only you can see this" banner when you're viewing your own.
- **Old URLs 301 → new** via `next.config.ts` `redirects()`
  (`/att/u/:id` → `/profile/:id`, `/att/account` → `/profile/me/settings`), so
  existing links / bookmarks / the Strava app config keep working.

## Feasibility (no infra change)

CloudFront's **default behavior routes everything except `/analyse*` to the att
server**, so root-level `/profile/*` and `/api/account/*` reach att with no
CloudFront/CDK change. att has no Next `basePath` (the `/att` is baked into the
route folders), so `src/app/profile/*` + `src/app/api/account/*` serve at the root.

## Auth gating (`src/proxy.ts`)

- `/profile/me*` requires auth (redirect to `/att/auth?next=…`). `/profile/:id`
  (public profiles) is **not** gated.
- `/api/account/*` mutations (non-GET) require auth, same as the old `/att/api`
  gate. GET account endpoints stay protected by their own `getAuthUser()`.

## Touch points

- Pages moved: `att/u/[userId]` → `profile/[id]` (param `userId`→`id`; canonical
  redirect now `/profile/{handle}`); `att/account` → `profile/me/settings`; new
  `profile/me`.
- API moved: `att/api/account` → `api/account` (all ~37 fetch call sites updated).
- Links updated across both apps (~34 sites): `/att/u/` → `/profile/`,
  `/att/account` → `/profile/me/settings`; shared `AccountNav` own-profile href →
  `/profile/me`, account href → `/profile/me/settings` (cross-app `<a>`).
- Strava callback redirect → `/profile/me/settings?strava=connected`.

## Verified

att builds + 549 tests pass; Analyse builds + 61 tests pass. Route manifest shows
`/profile/[id]`, `/profile/me`, `/profile/me/settings`, `/api/account/*`.
