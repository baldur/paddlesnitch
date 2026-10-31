# Observability: dashboards and error notices

🚧 **O1 + O2 built 2026-10-25**: server telemetry, the three dashboards, zero-tolerance alarms, app/browser ingest, the contract, and the daily digest. Next is O3: the apps send `app_open` and crash reports. The owner's answers are under [Decisions](#decisions).

One place to see whether paddlesnitch is healthy as a product, deeper views
for each part, and **close to zero tolerance for errors**: every real error is
seen, the same day at the latest. It works
the same for the web site, the Android app, the iPhone app and the trackers,
and it can be built now without getting in the way of the app work.

## Where we are

- **Three dashboards**, all in `infra/lib/dashboards.ts` (moved out of `att-stack.ts` in O1a):
  - `paddlesnitch-app`: product events, pageviews, campaigns, server Lambda health
  - `paddlesnitch-firmware`: OTA rollout, boots, crashes, devices by version
  - `paddlesnitch-performance`: TTFB from the perf check, real server time, cold starts, CloudFront errors
- **Eight alarms** emailing through the `paddlesnitch-alerts` SNS topic: server
  crashes, throttles, near-timeouts, more than 5 logged errors an hour, tracker
  boot failures, tracker crashes, SES bounce rate and SES complaint rate.
- **Product events** go out as CloudWatch EMF (`emitMetric`, namespace
  `Paddlesnitch/App`, the only dimension is `Event`, a strict allowlist in
  `@paddlesnitch/ui/metrics-events`). Browsers send theirs in batches to
  `POST /att/api/track`.

What's missing:

1. **We can't tell platforms apart.** Web, Android and iPhone all call the same
   `/api/trpc`, and nothing in the request says which one it was.
2. **API failures are invisible.** When a tRPC procedure throws, nothing logs it
   as an API error. The general "ERROR in the log" alarm sees some of it, mixed
   in with everything else.
3. **The apps can't send analytics.** `/att/api/track` drops any request without
   one of our website Origins, and native apps don't send an Origin.
4. **Browser errors aren't captured.** When the `error.tsx` page appears, nobody
   finds out.
5. **No app crash reporting yet.**
6. **The dashboards are organised by history, not by question.** There's no
   single "is everything OK?" view.

## Principles

1. **The server is the source of truth.** Every platform goes through the same
   API, so most "is it broken?" questions are answered server-side, where
   numbers can't be faked or lost to a phone going offline. Client telemetry
   only covers what the server can't see: crashes, browser errors, app opens.
2. **Platform is a filter, not a dashboard.** Every chart can be split by
   `web` / `android` / `ios`. There are no separate per-platform dashboards:
   most problems are in the shared API and would show up three times, and three
   copies drift apart. When iOS ships, it appears as a new line, with no new
   work.
3. **Close to zero tolerance, without noise.** The bar is that a real error
   doesn't happen. So the alarms fire on the **first** server error, failed
   action or crash, and the daily digest lists every error of the day. That
   only works if "error" means *we* broke something: callers asking for
   something wrong (a bad password, a trace that misses the start line, a 404)
   are logged but never counted, and expected conditions are logged as warnings,
   not errors. Alarms fire per 15-minute window, so a burst is one email, not
   fifty.
4. **Pay for metrics only where an alarm needs them.** Breakdowns (by platform,
   app version, procedure) come from Logs Insights queries over structured log
   lines, which are free to store as part of the Lambda logs and cost pennies to
   query. Custom metrics (about $0.30/month each) are used only for what an alarm
   watches.
5. **No personal data, no third-party SDKs by default.** No user ids, emails,
   coordinates or free text from users in telemetry. App crash reports carry the
   app's own stack frames, never user content. The stores' free crash consoles
   are used before any SDK.
6. **Stays out of the app agents' way.** All of this is server and infra work.
   The apps are asked for one request header first, and a crash report later,
   each written down in `mobile/contract/`.

## The dashboards

The first three custom dashboards are free, and each one after that costs
**$3/month**. We already have three, so the layout stays at **three** until the
apps ship and earns a fourth only then.

| Dashboard | What's on it | Comes from |
|---|---|---|
| `paddlesnitch-health` | The one to open first (below) **plus the web view**: pageviews, campaigns, product events, browser errors | Replaces `paddlesnitch-app` (its web widgets move here) |
| `paddlesnitch-api` | The deep dive on the server: errors per procedure and code, slowest procedures, actions in detail (outcome × platform × app version), **everything that's on the performance dashboard today** (TTFB, server time, cold starts, CloudFront errors), and **email and sign-in** (SES sends, bounces, complaints, rejects; Cognito sign-ins and failures) | Replaces `paddlesnitch-performance` |
| `paddlesnitch-firmware` | Unchanged | Kept |
| `paddlesnitch-mobile` (O3) | Android and iPhone **side by side**: app opens, crashes and crash rate per version, top crash signatures, version adoption, API errors seen by app clients | New when the Android app ships: the only paid one, $3/month |

Two dashboard names change (`-app` → `-health`, `-performance` → `-api`), so
old bookmarks stop working. The `DashboardUrl` stack output points at
`-health`.

### `paddlesnitch-health`: the one to open first

It answers two questions: is anything broken right now, and are people using it?

| Row | Widgets |
|---|---|
| Status | **Alarm status** widget (every alarm, green/red). A text widget with links to the deep dives and to the Play Console / App Store Connect crash pages |
| Errors today | Server errors · failed actions · app crashes · browser errors: each a single number for the selected range, which should read **0** |
| API | Requests and server-error count · p95 response time · errors by platform (Logs Insights) |
| Key actions | Success rate per **action**: sign in, upload a paddle, analyse, tracker sync, Strava import. One line per action; a Logs Insights table breaks each down by platform |
| Use | Active sessions per day by platform · sign-ups and uploads per day |
| Apps | Crash count by platform · share of users on the latest app version (once the apps report) |
| Trackers | Devices active today · crashes today (summary; detail stays on the firmware dashboard) |
| Web | The widgets that are on `paddlesnitch-app` today: pageviews by path, events by type, campaigns |

## What gets recorded

### Which client sent a request

The apps already send one header on their calls: `x-paddlesnitch-app`, which
the sign-in routes use to answer with tokens instead of cookies (mobile C2).
Observability **reuses it**, so there's no second header. Android already sends
it on every request; iOS needs to send it on every request, not just sign-in.

```
x-paddlesnitch-app: android/0.1.0
x-paddlesnitch-app: ios/1.0.0 (7)
```

`<platform>/<version> (<build>)`. One pure helper, `clientOf(headers)` in
`@paddlesnitch/core/observe`, reads it:

- header present and well-formed → `{ platform: 'android' | 'ios', version, build }`
- no header → `{ platform: 'web' }`
- anything else → `{ platform: 'other' }`, so a junk header can't add new values

Server-side callers that aren't a person's client set it themselves: `tracker`
(the tracker's own upload) and `server` (the Strava webhook's auto-import).
Lines then carry `platform`, plus `appVersion` and `build` for apps.

**Every telemetry line is an EMF document** (like `emitMetric`): CloudWatch
makes the metrics straight from it, with no metric filters, and Logs Insights
sees every property. (The Lambda log format is plain text, so JSON metric
filters wouldn't match the prefixed lines anyway.)

### API calls (server)

A timing middleware on every tRPC procedure (`packages/api/src/trpc.ts`,
outermost, so it also sees auth and input errors) writes **one line per HTTP
call**:

```json
{"kind":"api_call","path":"paddles.get","type":"query","ok":false,"code":"INTERNAL_SERVER_ERROR","ms":412,"platform":"android","appVersion":"1.0.3","Calls":1,"ServerErrors":1}
```

- Namespace `Paddlesnitch/Api`, no dimensions: two metrics, `Calls` and
  `ServerErrors`. `ServerErrors` is 1 only for codes that mean we broke
  something (`INTERNAL_SERVER_ERROR`, `TIMEOUT`, `NOT_IMPLEMENTED`,
  `BAD_GATEWAY`, `SERVICE_UNAVAILABLE`, `GATEWAY_TIMEOUT`).
- Caller mistakes (`UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`, …) are logged
  for the dashboard but never counted. A burst of `UNAUTHORIZED` from one app
  version is worth seeing on a dashboard, but it's not a 3 a.m. email.
- Only HTTP calls are logged (the mount puts `client` on the context).
  In-process calls (server rendering, tests) aren't.
- No input, no user id, no error message text (it can contain user data). The
  mount's `onError` keeps the stack trace in the log (`console.error`) for
  server errors only.

### Actions (server)

An action is something a user does that we care about succeeding. Each attempt
writes one line:

```json
{"kind":"action","Action":"upload","outcome":"rejected","reason":"http_422","platform":"web","Attempts":1,"Failures":0}
```

| Action | Where |
|---|---|
| `sign_in` | `POST /att/api/auth/login` and `otp-verify` (wrapped), and the Strava sign-in callback (logs its own outcome). The apps use the same routes |
| `upload` | trial upload and paddle upload (`/paddles/api/analyse`), wrapped |
| `analyse` | `analyseAndSave`: every paddle analysed, whichever way it came in |
| `device_sync` | the tracker's upload (`platform: tracker`) and the phone's Bluetooth relay, wrapped. One line per upload request (each part) |
| `strava_import` | `importStravaActivity`: on-demand import (the client's platform) and webhook auto-import (`server`) |

`outcome` is one of:
- **`ok`**: it worked (2xx, or a redirect).
- **`rejected`**: the user's input was refused, which is expected and not
  counted. Examples: a wrong password, a trace that misses the start line, a
  Strava activity that isn't a paddle, turning Strava down. Wrapped routes:
  any 4xx.
- **`fail`**: we let the user down. Wrapped routes: any 5xx, or a throw.

Routes are wrapped with `withAction(action, handler)` (`apps/web/src/lib/action.ts`),
which reads the outcome from the status code.

Metrics: namespace `Paddlesnitch/Actions`, `Attempts` and `Failures`, per
`Action` and in total (5 × 2 + 2 = 12 metrics). The zero-tolerance alarm
watches total `Failures`. The platform split is a Logs Insights widget.

### Client events (apps and browsers)

`POST /att/api/track` keeps its batch format and gains:

- **App acceptance.** A request with a valid `x-paddlesnitch-app` app header
  is accepted without an Origin. That's spoofable, just like Origin is today,
  so it's the same honest limit: the allowlist and the per-request caps are what
  stop abuse, not the header.
- **New allowlisted events:** `app_open`, `crash_report`, `client_error`.
- **Platform** from `clientOf(req)` on every event.

#### App crash report: sent on the next launch

The same pattern the trackers use for crash reports (a coredump summary sent to `/api/devices/health` on the next start):

1. The app catches the uncaught exception, writes a small file and lets the
   crash happen.
2. On the next start it sends one `crash_report` event and deletes the file.

```json
{"event":"crash_report","t":1761380000000,"props":{
  "appVersion":"1.0.3","build":"42","os":"Android 14",
  "type":"java.lang.IllegalStateException",
  "frames":"com.paddlesnitch.paddles.PaddleScreen.render:212|com.paddlesnitch…"}}
```

- Our own package's frames only (at most 12), joined with `|`, no file paths, no
  exception message (it can hold user data).
- `signature` = the exception type plus the top frame, so the dashboard can
  group identical crashes.
- Crash rate = crash reports ÷ `app_open`, by platform and version (Logs
  Insights). The alarm watches the plain `crash_report` count, so no
  `Platform` metric dimension is needed.
- The exact rules for the apps are in
  [`mobile/contract/telemetry.md`](../../mobile/contract/telemetry.md), with
  fixtures that `pnpm test` replays against the endpoint. The server keeps only
  the fixed fields: frames that look like a path or a message are dropped, and
  the app's `appVersion` prop is stored as `crashedVersion` (the crashed
  version can be older than the reporting one).

Native crashes (ANR, out-of-memory, crashes in native code) don't reach this.
**Google Play's Android vitals and Apple's App Store Connect crash pages** cover
those for free, and the health dashboard links to them.

#### Browser errors

A small client hook (`window` `error` + `unhandledrejection`, and the
`error.tsx` page) sends `client_error` with the error type, the first line of
the message cut to 120 characters, and `publicPath(location.pathname)`. At
most 5 per page load, and the same message once. Only errors from **our own
scripts** are sent: an error whose source is another origin (browser
extensions, third-party scripts), or the browser's opaque `Script error.`, is
dropped at capture, so the zero-tolerance alarm only hears about our code.

### Archive: every analytics event, kept indefinitely (2026-10-31)

Logs go after three months and CloudWatch keeps only counts, so the detail behind every analytics event would otherwise be lost. The owner decided to keep it all, indefinitely, for analysis later. The privacy page says so ("Usage records" and "Error reports"). It can't be erased, so nothing in it may identify anyone: that's enforced twice.

- **Path:** the server Lambda's log group → subscription filter `analytics-archive` (a cheap pre-filter on the word `Event`) → Firehose `paddlesnitch-analytics-archive` → transform Lambda `paddlesnitch-analytics-archive` (`infra/lambdas/analytics-archive`) → bucket `paddlesnitch-analytics-archive`, gzipped, one JSON object per line, under `events/year=YYYY/month=MM/day=DD/`. A file every 15 minutes at most.
- **What's kept:** everything with an `Event`: pageviews, sign-ins, sign-ups and uploads (no props), campaign events, game events, app opens, crash reports and page errors.
- **First line of defence, the track route:** every client event keeps only its own props (`clientEventProps`: the game rules, `campaign` on pageview and campaign_cta, nothing on the rest), its path goes through `publicPath` (every dynamic page is checked by `public-path.test.ts`, which walks `src/app`; only trial and course ids stay) or must be an `app:<screen>`, and `sid` must look like a random id.
- **Second, the transform:** only known fields (`KEEP`) whose values look like a word, number or code (`looksSafe`: no `@`, no sentences), paths cleaned again (`cleanPath`, the same as `publicPath`; this covers the 90 days of older lines the backfill reads), no error message text, the time rounded down to the hour (`ts`), and no tab id on a game result (`game_play`): a result on a public leaderboard could otherwise be matched to a name, and the tab id would then name the whole visit.
- **Failures:** a batch the transform can't read, or that would take its answer past Lambda's 6 MB (it gets 0.25 MB at a time), goes to `errors/`: raw, uncleaned lines, so it expires after 30 days. Two alarms email on any failure (`paddlesnitch-analytics-archive-transform`, `-delivery`); Firehose logs to `/aws/kinesisfirehose/paddlesnitch-analytics-archive`.
- **Kept:** `events/` has no expiry and the bucket is `RETAIN`. Firehose can write but not delete.
- **Backfill:** after the first deploy, `bash infra/scripts/analytics-backfill.sh` (signed in with `aws sso login --profile paddlesnitch`) copies what the logs still hold (90 days) into `events/…/backfill.json.gz`, a file per day, up to the moment the subscription started, so nothing is counted twice. Days already there are skipped.
- **Reading it:** download a day (`aws s3 cp --recursive s3://paddlesnitch-analytics-archive/events/year=2026/month=11/ .`) and `zcat`, or point Athena at `events/` with the year/month/day partitions.
- **Cost:** Firehose about $0.03/GB in, the transform a few cents, S3 pennies, two alarms $0.20/month.
- **Tests:** `analytics-archive.test.ts` (the transform), `public-path.test.ts` (every route, and the transform's copy), `track-route.test.ts` (props, paths, sid), `observability-infra.test.ts` (the wiring, no expiry, no delete, the alarms, the privacy line).

## Alerts

Two channels, both through the existing `paddlesnitch-alerts` topic:

- **Email now**: alarms, fired on the **first** error in a 15-minute window.
  A burst is one email.
- **Daily digest**: one email every morning listing *every* error of the
  previous day, grouped. It's the long-term record, and the place to spot
  something small that keeps coming back.

| Alarm | Fires when | Notes |
|---|---|---|
| `paddlesnitch-api-errors` | **≥ 1** server error (`INTERNAL_SERVER_ERROR`, `TIMEOUT`) in 15 min | New. Callers' mistakes (`UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`, …) never count |
| `paddlesnitch-action-failed` | **≥ 1** `fail` on any action in 15 min | New. One alarm over the sum of the five `fail` metrics; the email names the action via the digest and the dashboard |
| `paddlesnitch-app-crashes` | **≥ 1** crash report in 15 min, either platform | New in O3 |
| `paddlesnitch-browser-errors` | **≥ 1** `client_error` from **our own scripts** in 15 min | New. Errors from browser extensions and third-party scripts (another origin, or `Script error.` with no source) are dropped at capture, so they can't trip it |
| `paddlesnitch-server-errors` (existing) | Tightened from > 5 an hour to **≥ 1** `ERROR` line in 15 min | Tightened after the clean-up below. It catches what the API alarm can't see (REST routes, background jobs) |
| The other seven existing alarms | unchanged | Crashes, throttles, near-timeouts, tracker boot failures and crashes, SES bounce and complaint rates |

### Getting to zero first (start of O1)

Zero tolerance only works if today's logs are already quiet, otherwise the
first week is an inbox of known noise and the alarms get ignored. Before the
thresholds go to ≥ 1:

1. Count and group every `ERROR` line and Lambda error over the last 30 days
   (Logs Insights).
2. For each group: **fix it** if it's a bug, or **log it as a warning**
   (`console.warn`, which the alarm doesn't count) if it's an expected
   condition. Example: a best-effort write that's allowed to fail.
3. Only then switch the alarms to ≥ 1. Anything new after that is real by
   definition.

The rule from then on: **`console.error` means "we broke something and want to
hear about it"**. Expected failures use `console.warn`. This goes in CLAUDE.md
as a convention.

### Clean-up result (2026-10-25)

Logs Insights over the last 30 days of the server, jobs, game relay and image
Lambdas (109 MB scanned): **no application `console.error` lines at all**. Every
error belonged to two incidents, both already fixed:

- **2026-10-21 19:04–20:16 UTC, server down for 72 minutes.** Deploy `ae2178c`
  shipped an incomplete OpenNext server bundle (`Cannot find module
  '@swc/helpers/…'`, 162 failed starts, 44 failed job sweeps). The existing
  crash alarm fired. Fixed by the next deploy, and #579 now stops a deploy whose
  server bundle is incomplete.
- **2026-10-23 08:21 UTC, one response over Lambda's 6 MB limit** (413, river
  planner data). Fixed the same day by serving the overview in chunks (#607).

Also seen: an AWS SDK Node-version warning (gone since 2026-09-29), and bots
calling `/_next/image` with no URL (the image Lambda's own log group; it doesn't
reach the server alarm).

One code change came out of it: a background job attempt that will be retried
now logs `console.warn`; only the attempt that gives up logs `console.error`.

### Daily digest

`ErrorDigestFn` (`infra/lambdas/error-digest/`), run by EventBridge at
**07:00 UTC** (07:00 or 08:00 in the UK). It runs seven Logs Insights queries
over the server's log group and publishes one email to the alerts topic:

- errors the server logged, grouped by message
- API calls that failed on our side, by procedure, code and platform
- key actions that failed, by action, reason and platform
- app crashes by platform, crashed version and signature
- browser errors by message and page
- activity (API calls, key actions), so a quiet day is visibly quiet, not empty
- app versions seen for the first time in the last day (from a 14-day look-back)

The subject is `paddlesnitch 2026-10-25: all clear` or `…: 4 errors`. A day
with no errors still sends the all-clear line, and `paddlesnitch-digest-failed`
alarms if the digest itself fails, so a missing email never reads as a quiet
day. Queries and formatting are pure (`digest.mjs`, tested in
`error-digest.test.ts`); `index.mjs` only runs them. All seven queries were
run against production when this was written.

### Later: automatic rollback

Once the error log has stayed clean for a while, a new deploy that's followed by
an `api-errors` or `action-failed` alarm within N minutes can roll itself back:
the server Lambda moves to an alias, and a deploy shifts the alias only after a
quiet window. It's not part of this spec. It's what the zero bar makes possible.

## Privacy

- This is operational telemetry: the platform, the app version, error *types*
  and our own code locations. It never carries user ids, emails, coordinates,
  paddle data or text users typed. The existing `sid` (random per browser tab)
  stays the only session marker. Apps get **no** install id.
- That keeps it out of scope of the consent-gated behavioural analytics
  ([`behavioural-analytics.md`](behavioural-analytics.md)), which is about
  *how* people use the UI and is still unbuilt.
- The privacy page gains one sentence saying the apps report crashes (app
  version, device type, where in our code it failed).

## Cost

| Item | Roughly |
|---|---|
| Dashboards: three until the apps ship (all within the free three), then `-mobile` | $0, then $3/month |
| ~17 new custom metrics (API calls + server errors; action attempts + failures, per action and in total = 12; `app_open`, `crash_report`, `client_error` as `Event` counts) at $0.30 | $5/month |
| ~4 new alarms at $0.10 | under $1/month |
| Digest Lambda (once a day) + its Logs Insights queries (scanning a day of logs) | pennies |
| Extra log lines (one per API call) | well under $1/month at today's traffic |
| Logs Insights behind dashboard widgets | free when run from the console |

About **$6/month** now, **$9/month** once the mobile dashboard exists.

## Phases

| Phase | What | Touches the apps? |
|---|---|---|
| **O1: server** ✅ | (a) Small PR: move the dashboards into `infra/lib/dashboards.ts`, no change in what they show. (b) Get to zero: group 30 days of errors, fix or downgrade each. (c) `clientOf()` · tRPC `onError` + `api_call` lines · action lines on the five actions. (d) `paddlesnitch-health` + `paddlesnitch-api` (replacing `-app` and `-performance`) · the API and action alarms at ≥ 1 · tighten `server-errors` | No |
| **O2: contract, ingest, digest** ✅ | `mobile/contract/telemetry.md` + fixture JSON for the header, client events and crash report · `/att/api/track` accepts app requests · new allowlisted events · browser error capture + alarm · the daily digest | No. Only the contract is written for them |
| **O3: apps adopt** | Android sends the header (one line in its HTTP client) and `app_open`, then crash reports · `paddlesnitch-mobile` + the crash alarm | Yes, when the app agent is ready |
| **iOS** | Follows the same contract. Nothing new server-side | Yes, when the iPhone app is built |
| **Later** | Automatic rollback on a post-deploy alarm | No |

O1 and O2 only change server and infra files. The one overlap risk is
`infra/lib/att-stack.ts`, which other agents also edit. O1(a) moves the
dashboard code into its own file in a small PR of its own, so later dashboard
work never touches the stack file.

## Tests

- `clientOf()`: header parsing, unknown platforms → `other`, junk is bounded.
- API calls (`observability.test.ts`): a call over HTTP from the Android app
  writes one `api_call` line with path, platform and version; a signed-out call
  and bad input are logged but not counted as server errors; in-process calls
  write nothing.
- Actions: 2xx/3xx → ok, 4xx → rejected, 5xx or a throw → fail (rethrown);
  every action route is wrapped (source check); a Strava import with no
  connection is a rejected skip, not a failure.
- `/att/api/track`: app header accepted without an Origin; no header and no
  Origin still dropped; new events allowlisted; crash-report props are bounded
  and stripped to the allowed fields.
- Browser hook: at most 5 per load, deduplicated, path through `publicPath`,
  extension and third-party errors dropped.
- Digest: given canned Logs Insights results, it builds the expected email,
  including the "all clear" when everything is zero.
- Infra: dashboards and alarms asserted from the stack source, like
  `ses-delivery-alerts.test.ts`. Each error alarm fires at ≥ 1 per 15 minutes,
  and expected caller errors are excluded from the server-error metric.
- Contract: the telemetry fixtures validate against their schema in `pnpm test`.

## Decisions

Answered by the owner on 2026-10-25:

1. **Log every API call** (`api_call`) until the volume becomes a problem, then
   sample.
2. **Fewest dashboards.** Stay at the three free ones by merging (`-app` →
   `-health`, `-performance` + email → `-api`). Add `-mobile` only when an app
   ships.
3. **Our own crash reporting** (report on next launch) plus the free store
   consoles. No Sentry or Crashlytics.
4. **Close to zero tolerance**, kept for as long as possible: alarms on the
   first error, after a clean-up that makes today's logs quiet, and the
   `console.error` = "we broke something" convention.
5. **Daily digest of errors** (O2). Later, once the slate stays clean, hook up
   automatic rollback.
