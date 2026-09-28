# Sitemap

**Status:** ✅ current map, after the 2026-09-28 navigation clean-up (PRs #287–#292).
It replaces the 2026-09-06 proposal, most of which is now done: a real front door
(`/` for visitors, your paddles once signed in), platform concepts at the top level
(`/account`, `/devices`), one name per thing, and no "My" in the menu. Still open
from the proposal: moving `/att/groups` to `/groups`, and renaming `/att` itself
(user-facing it is already "Trials"; the URL is historical and costly to move).

Audience key: **P** public · **A** signed in · **M** owner / group admin.
Sign-in gating is in `apps/web/src/proxy.ts`: `/account*`, `/devices*`,
`/profile/me*`, `/att/admin*`, and non-GET `/att/api/*` + `/api/account/*`.
Everything else checks deeper (a private resource answers 404, not 403).

## Header and menu

- **Tabs:** TRIALS (`/att`), PADDLES (`/paddles`). The lit tab follows the URL;
  pages in neither section light neither.
- **Account menu** (signed in): PADDLES, DEVICES, PROFILE, ACCOUNT, REPORT AN
  ISSUE, SIGN OUT. Signed out: SIGN IN (returns you to the page you were on).
- **Footer:** PRIVACY, ACCOUNT.

## Platform

```
/                            P  landing for visitors; signed in → /paddles.
                                ?campaign=<id> serves a campaign landing to everyone
                                (e.g. ?campaign=betatesters)
/account                     A  ACCOUNT: details, Strava, pointer to Devices, public
                                profile + handle (#profile), download, delete
/devices                     A  DEVICES: one card per tracker + Add a tracker (#add)
/devices/[deviceId]          A  one tracker's recordings (plain summary + TECHNICAL
                                DETAILS), REMOVE TRACKER
/devices/[deviceId]/[sessionId]  A  BOAT MOTION charts for one recording
/guide                       P  tracker setup guide: overview + one page per step
/guide/<step>                P  account, switch-on, wifi, link, boat, record, upload
/guide/troubleshooting       P  problems by symptom, each linkable (#wifi, #code, …)
/profile/[id-or-handle]      P  public profile (opt-in; 404 if private). Owner sees
                                EDIT PROFILE → /account#profile
/profile/me                  A  → your own profile
/l/[code]                    P  tracker QR target → /devices?code=…#add
                                (/L/[code], uppercase, is rewritten to it in the proxy)
```

## Paddles

```
/paddles                     P/A  PADDLES: totals + every paddle (compare two,
                                  delete). Signed out: sign-in panel
/paddles/new                 A    ADD A PADDLE: upload / Strava / time trials / tracker
/paddles/[id]                A    one paddle (map, summary, efforts and rests, share,
                                  diary, boat class, pick a section)
/paddles/compare?a=&b=       A    two paddles side by side
/paddles/compare/section     A    one section across your paddles
/paddles/shared/[shareId]    P    a shared paddle (read-only; plain summary)
```

## Trials (`/att`)

```
/att                         P  open time trials + recent results
/att/courses                 P  course catalogue
/att/courses/[courseId]      P  a course (visibility applies)
/att/trials/[trialId]        P  leaderboard
/att/trials/[trialId]/upload P/A  submit a result (?invite= for submit links)
/att/entries/[entryId]       P  one result
/att/groups                  A  your groups
/att/groups/[groupId]        A  a group (?join= for join links)
/att/admin/courses/new       M  create a course
/att/admin/courses/[id]      M  manage a course, open trials
/att/admin/trials/new        M  create a trial
/att/admin/trials/[id]       M  manage a trial
/att/auth, /att/auth/forgot, /att/auth/reset  P  sign in / sign up (for the whole site)
/att/faq, /att/tos, /att/privacy              P  help and legal
```

## Old URLs (all permanent redirects, one hop)

```
/profile/me/settings, /att/account     → /account
/profile/me/devices                    → /devices
/profile/me/devices/d/[id]             → /devices/[id]
/profile/me/devices/[sessionId]        → /devices/[deviceId]/[sessionId] (looked up)
/paddles/library, /analyse/library     → /paddles
/analyse, /analyse/*                   → /paddles, /paddles/*
/att/u/[id]                            → /profile/[id]
```

`apps/web/src/tests/redirects.test.ts` checks these and fails on any chained
redirect.
