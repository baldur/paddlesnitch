# Feature: sitemap + information-architecture proposal

**Status:** 🚧 proposal (2026-09-06). **Not executed** — a current-state map + a
target IA to align on *before* any route moves.
**Owner:** Baldur (product), Claude (implementation).

## Why

The platform has grown to two apps + a platform-level account area, and the URL
structure has drifted rather than been designed: the front door is a stub, an
internal abbreviation is exposed in the public path, and one platform concept
lives under an app prefix. This records the current tree and proposes a target so
reorganisation can happen deliberately (route moves are redirect-heavy — see
[`profile-routes.md`](docs/features/profile-routes.md) for how `/att/u`→`/profile`
was handled: `next.config` 301s + threaded links, in one careful step).

## Current-state sitemap

Audience key: **P** public · **A** authenticated · **M** owner/group-admin.
Auth gating lives in `apps/att/src/proxy.ts` (gates `/att/admin`, `/profile/me*`,
and non-GET `/att/api` + `/api/account`; everything else passes and gates deeper).

### Platform (root domain)
```
/                         P  landing (currently a stub → links to /att)     [att]
/profile/[id]             P  public paddler profile (opt-in; 404 if private) [att]
/profile/me               A  redirect to your own public profile            [att]
/profile/me/settings      A  account settings (Strava, profile, handle, ToS, devices, export/delete) [att]
/profile/me/devices       A  hardware-tracker data page                     [att]
```

### ATT — Automated Time Trials (served at `/att`; `apps/att`, no basePath)
```
/att                          P  home — open trials + recent submissions
/att/courses                  P  course catalogue
/att/courses/[courseId]       P  course detail (+ manage if M)
/att/trials/[trialId]         P  trial leaderboard + course map
/att/trials/[trialId]/upload  A  submit a trace (gated by participation / submit token)
/att/entries/[entryId]        P  a single entry's result + map
/att/groups                   A  your groups
/att/groups/[groupId]         A  group page (limited projection to non-members)
/att/admin/courses/new        M  create course
/att/admin/courses/[courseId] M  manage course + create trials
/att/admin/trials/new         M  create trial
/att/admin/trials/[trialId]   M  manage trial (open/close, visibility, invites, submit link)
/att/auth  · /att/auth/forgot · /att/auth/reset   P  sign in / sign up / password reset
/att/faq · /att/privacy · /att/tos                P  static + legal
```

### Analyse — paddle-session analysis (served at `/analyse`; `apps/analysis`, basePath `/analyse`)
```
/analyse                    A  upload / Strava import / analyse an ATT entry / MY TRACKER
/analyse/[id]               A  a saved paddle (owner)
/analyse/library            A  My Paddles
/analyse/compare            A  compare your paddles
/analyse/compare/section    A  race-a-section board
/analyse/shared/[shareId]   P  public shared paddle (read-only; + OG share card)
```

## Observations / seams

1. **No real front door.** `/` is a stub that links to `/att`. Nothing frames the
   platform as a whole (analyse + trials + profile) or routes a new visitor to the
   right place. This is the biggest gap.
2. **`/att` leaks an internal abbreviation.** "Automated Time Trials" is an
   internal name; users see `/att` in every trial URL. Renaming is a large move —
   the entire app lives under `apps/att/src/app/att/` with the prefix baked in
   (no Next `basePath`), and CloudFront routes `/att/*` to the att Lambda.
3. **Groups sit under an app prefix.** `/att/groups` — but a group is a *platform*
   concept: it owns courses/trials today and could scope Analyse later. Profile,
   account, and devices are already platform-level (`/profile/*`) — that's the
   precedent groups doesn't yet follow.
4. **Cross-app navigation is shallow.** The shared header has Trials↔Analyse tabs,
   but there are no deep cross-links — e.g. "analyse this entry" exists, but
   "submit this analysed paddle to a trial" does not; the two products still read
   as separate.
5. **Auth entry is att-scoped.** Sign-in lives at `/att/auth`, yet it gates
   platform-level pages (`/profile/me*`) and the Analyse app. It reads as "the ATT
   login" rather than the platform login.
6. **Two "upload/analyse" front doors.** `/analyse` (analyse a session) and
   `/att/trials/[id]/upload` (submit to a trial) are separate entry points for
   "here's my GPS file"; a visitor may not know which they want.

## Proposed target IA (for discussion — do not execute yet)

- **A. Real front door at `/`.** Replace the stub with a platform landing that
  explains paddlesnitch and routes to **Analyse a paddle**, **Time trials**, and
  (signed-in) **your profile / library**. Lowest-risk, highest-value first step;
  no route moves, just a real page. **Recommend doing this first.**
- **B. Keep platform concepts platform-level.** Profile/account/devices already
  are. Propose moving **groups → `/groups`** (platform) to match, with 301s from
  `/att/groups*`. Medium effort, clean precedent.
- **C. `/att` rename — explicit option, not a given.** Friendlier would be
  `/trials` (or drop the prefix so trials live at root). **Cost:** move the whole
  `apps/att/src/app/att/` tree, add a Next `basePath` or re-nest folders, update
  every internal `href`/`fetch`/`router.push` (the prefix is hardcoded per the
  conventions), a CloudFront behaviour change, blanket 301s, and SEO churn on
  existing trial links. **Recommendation:** defer — do A and B first; only take
  the rename if the public URL becomes a real concern, and then as its own project
  with redirects, mirroring the `profile-routes` playbook.
- **D. Deeper cross-app links.** Add the missing bridges (e.g. "submit to a trial"
  from an analysed paddle; "analyse" from a trial entry where absent) so the two
  apps feel like one product. Small, incremental, no route moves.
- **E. Unify auth framing.** Treat `/att/auth` as the platform sign-in (copy +
  entry points), or later lift it to a platform route. Copy-only first; a route
  move is a C-sized change.

**Sequencing.** A (front door) → D (cross-links) → B (groups → `/groups`, with
301s) → E/C (auth + `/att` rename) only if warranted. Each route move ships in a
small, redirected step; nothing moves until the target here is agreed.
