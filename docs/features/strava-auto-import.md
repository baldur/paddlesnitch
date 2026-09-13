# Strava auto-import (webhooks)

🚧 **In progress — 2026-09-13.** New water-sport activities on a connected
athlete's Strava appear as paddles automatically, via the Strava **Webhook
Events API** — no manual "FROM STRAVA" click. Builds on the existing on-demand
import ([`paddle-analysis.md`](paddle-analysis.md)); reuses the same import
pipeline end to end.

## How it works

1. **Subscription (one per app, ops-created once).** We register a single push
   subscription with Strava (`POST /api/v3/push_subscriptions`, with our
   `client_id` + `client_secret` + `callback_url` + `verify_token`). Strava
   immediately GETs the callback to validate it, then POSTs an event for **every**
   activity/athlete change for **every** athlete who has authorised our app.
2. **Callback** `GET|POST /api/strava/webhook` (platform-level, unauthenticated —
   Strava is the caller):
   - **GET** = subscription validation: Strava sends `hub.mode`, `hub.challenge`,
     `hub.verify_token`; we check the verify token and echo
     `{ "hub.challenge": <challenge> }`. A wrong token → 403.
   - **POST** = an event: `{ object_type, aspect_type, object_id, owner_id,
     subscription_id, event_time, updates }`. The body carries **no activity
     detail** — only ids. We **acknowledge 200 immediately** (Strava requires a
     response within ~2 s and retries otherwise) and do the work in `after()`.
3. **Processing (after the 200):**
   - `object_type: 'activity', aspect_type: 'create'` → map `owner_id`
     (Strava athlete id) → our user via the existing `strava-athletes/{id}` reverse
     index. If the user has a valid token **and auto-import is enabled**, fetch the
     activity, keep it only if its sport is in `WATER_SPORT_TYPES` (kayak / canoe /
     rowing / SUP / virtual row), pull its streams, and run the **same import
     pipeline** as a manual import (`analyseAndSave`) — including duplicate
     detection, so nothing is imported twice.
   - `object_type: 'athlete', updates.authorized: 'false'` (**deauthorization**) →
     treat exactly like Disconnect: revoke is already done on Strava's side, so we
     delete the user's tokens + reverse index. (Guideline compliance — see below.)
   - `activity` `update` / `delete`, and non-water sports → **ignored** (documented
     decision, see Lifecycle).

The webhook create path shares one function with the manual picker:
`importStravaActivity(userId, activityId)` → `analyseAndSave(userId, track,
source)`. The only new work vs. a manual import is the webhook plumbing + the
owner→user lookup + the sport filter.

## Opt-in / opt-out

- A per-user setting `autoImport` (stored at `users/{userId}/strava-prefs.json`),
  **default ON**. Rationale: connecting Strava is itself the consent, we only ever
  touch **water-sport** activities, and it's one toggle to turn off. A user who has
  not connected Strava is unaffected (no tokens → the webhook skips them).
- Toggle in **Account → Strava integration** (only shown when connected):
  "Automatically import new Strava paddles" (on by default). Backed by
  `POST /att/api/strava/auto-import { enabled }`; `GET /att/api/strava/status`
  reports the current value.
- **Disconnect** stops everything (tokens gone → webhook skips the athlete).

## Strava guideline compliance

- **Read-only, never post.** Scope stays `read,activity:read_all` (+
  `profile:read_all` for sign-in). We never write to Strava. Auto-import only
  READS activities the athlete already owns.
- **Fast ack.** The webhook returns 200 within the required window and processes
  asynchronously (`after()`), so we never hold Strava's request open.
- **Athlete control / deauthorization.** Disconnect in-app AND the `authorized:
  'false'` webhook event both delete the athlete's stored tokens + reverse index.
  After deauth we hold no Strava credentials and make no further calls for them.
- **Data minimisation.** We store only the derived paddle analysis + a trimmed
  source reference (`stravaActivityId`, sport) — never the raw Strava payload.
- **Attribution.** The connected UI shows "Powered by Strava" / the athlete name
  and links back to the activity (existing `PoweredByStrava` / `ViewOnStrava`),
  per the Strava brand guidelines.
- **Rate limits.** One activity fetch + one streams fetch per new water-sport
  activity, on the athlete's own token; no polling. The old manual pull is
  unchanged.
- **Verify token.** The subscription `verify_token` is a secret
  (`STRAVA_WEBHOOK_VERIFY_TOKEN`, SSM `/att/strava-webhook-verify-token`), so only
  Strava's validation with the matching token succeeds.

## Data lifecycle decisions (documented, tweakable)

- **Deauthorize** → delete tokens + reverse index (compliance; the saved paddles
  are the user's own derived analysis in our product, kept unless they delete their
  account or the paddle — same as a manually-imported one).
- **Activity deleted on Strava** → we do **not** auto-delete the saved paddle. It's
  the paddler's saved analysis; silently removing it on a Strava cleanup would
  surprise them. (Easy to flip to delete-on-delete later if wanted.)
- **Activity updated on Strava** → ignored for v1 (the analysis is a snapshot;
  re-analysing on every edit isn't worth the churn). Dedupe means a manual re-import
  after an edit still won't double up.

## Ops — one-time subscription setup (like the SES rule-set activation)

The callback must be live in prod before the subscription is created. After
deploy, once:

1. Put the verify token: `aws ssm put-parameter --name /att/strava-webhook-verify-token --type SecureString --value <random> ...`
2. Create the subscription (script `apps/web/scripts/strava-webhook.ts create`):
   `POST https://www.strava.com/api/v3/push_subscriptions` with client id/secret +
   `callback_url=https://paddlesnitch.com/api/strava/webhook` + verify token.
   Strava validates the callback synchronously; a non-2xx there means the endpoint
   isn't reachable/echoing the challenge.
3. `strava-webhook.ts view` lists the active subscription; `delete <id>` removes it.

Strava allows **one** subscription per API application, so this is create-once.

## Not built / out of scope

- Backfilling historical activities on connect (auto-import is forward-only; the
  manual "FROM STRAVA" picker still handles older ones).
- Re-analysing on activity `update`; deleting paddles on activity `delete`.
