# Observability: dashboards and error notices

📝 **Spec, for review: 2026-10-25.** Nothing built yet.

One place to see whether paddlesnitch is healthy as a product, deeper views
for each part, and alerts that only fire when something real is wrong. It works
the same for the web site, the Android app, the iPhone app and the trackers,
and it can be built now without getting in the way of the app work.

## Where we are

- **Three dashboards**, all in `infra/lib/att-stack.ts`:
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
3. **Alert on rates with a minimum volume, never on single events.** For
   example: "more than 5% of uploads failed in the last hour *and* at least 5
   failed". At 3 a.m. one failure out of one is 100%, and that's not a page.
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

### 1. `paddlesnitch-health`: the one to open first (new)

It answers two questions: is anything broken right now, and are people using it?

| Row | Widgets |
|---|---|
| Status | **Alarm status** widget (every alarm, green/red). A text widget with links to the deep dives and to the Play Console / App Store Connect crash pages |
| API | Requests and **server-error rate** (5xx), overall · p95 response time · errors by platform (Logs Insights) |
| Key actions | Success rate per **journey**: sign in, upload a paddle, analyse, tracker sync, Strava import. One line per journey; a Logs Insights table breaks each down by platform |
| Use | Active sessions per day by platform · sign-ups and uploads per day |
| Apps | Crash rate by platform (once the apps report crashes) · share of users on the latest app version |
| Trackers | Devices active today · crashes today (summary; detail stays on the firmware dashboard) |

### 2. Deep dives: one per component, not per platform

| Dashboard | What's on it | Status |
|---|---|---|
| `paddlesnitch-api` (new) | Errors per procedure and code · slowest procedures · journeys in detail (outcome × platform × app version) · Bearer vs cookie traffic | New, from the API error and journey log lines |
| `paddlesnitch-mobile` (new) | Android and iPhone **side by side**: app opens, crashes and crash rate per version, top crash signatures, version adoption, API errors seen by app clients | New, after the apps send events (phase O3) |
| `paddlesnitch-app` (existing) | Web: pageviews, campaigns, product events, plus **browser errors** (new widget) | Kept. The server Lambda widgets move to `-api` |
| `paddlesnitch-performance` (existing) | Unchanged | Kept |
| `paddlesnitch-firmware` (existing) | Unchanged | Kept |
| `paddlesnitch-email` (new, small) | SES sends, bounces, complaints, rejects, suppression adds · Cognito sign-ins and sign-in failures | New |

Existing dashboards keep their names, so bookmarks keep working.

## What gets recorded

### Which client sent a request

Every app request carries one header:

```
X-Paddlesnitch-Client: android/1.0.3 (42)
X-Paddlesnitch-Client: ios/1.0.0 (7)
```

`<platform>/<version> (<build>)`. One pure helper, `clientOf(req)`, reads it:

- header present and well-formed → `{ platform: 'android' | 'ios', version, build }`
- no header → `{ platform: 'web' }`
- anything else → `{ platform: 'other' }`, so a junk header can't add new values

Server log lines and events then carry `platform` (and `appVersion` for apps)
as plain properties.

### API errors (server)

The tRPC handler (`apps/web/src/app/api/trpc/[trpc]/route.ts`) gets an
`onError` that writes **one structured log line per failed call**:

```json
{"kind":"api_error","path":"paddles.get","code":"INTERNAL_SERVER_ERROR","platform":"android","appVersion":"1.0.3"}
```

- Codes that mean the server broke (`INTERNAL_SERVER_ERROR`, `TIMEOUT`) feed a
  metric filter → metric `ApiServerErrors` → alarm.
- Codes that mean the caller asked for something wrong (`UNAUTHORIZED`,
  `NOT_FOUND`, `BAD_REQUEST`, …) are logged for the dashboard but never alarmed.
  A burst of `UNAUTHORIZED` from one app version is a useful thing to see on a
  dashboard, but it's not a 3 a.m. email.
- No input, no user id, no error message text (it can contain user data).

Total calls per procedure come from the same handler: one
`{"kind":"api_call","path",…,"ms"}` line per call, so error *rates* can be
worked out. If that turns out too noisy for the log bill, it gets sampled. See
the open decisions.

### Journeys (server)

A journey is a user action we care about succeeding. At the end of each one,
the server writes:

```json
{"kind":"journey","journey":"upload","outcome":"ok","platform":"web"}
```

| Journey | Where it ends |
|---|---|
| `sign_in` | the password, email-code and Strava sign-in routes (the apps use the same routes and get tokens in the answer) |
| `upload` | trial upload (REST) and paddle upload (REST) |
| `analyse` | the analyse pipeline |
| `device_sync` | tracker session upload, after the last part |
| `strava_import` | on-demand import and webhook auto-import |

`outcome` is `ok` or `fail`. Failures we expect, like a trace that doesn't cross
the start line or a wrong password, are `ok` from a system point of view, with
a `reason` property. `fail` means *we* let the user down.

Metrics: one metric filter per journey and outcome (5 × 2 = 10 metrics, about
$3/month), no platform dimension. The platform split is a Logs Insights widget.

### Client events (apps and browsers)

`POST /att/api/track` keeps its batch format and gains:

- **App acceptance.** A request with a valid `X-Paddlesnitch-Client` app header
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
- Crash rate = crash reports ÷ `app_open`, by platform and version.

Native crashes (ANR, out-of-memory, crashes in native code) don't reach this.
**Google Play's Android vitals and Apple's App Store Connect crash pages** cover
those for free, and the health dashboard links to them.

#### Browser errors

A small client hook (`window` `error` + `unhandledrejection`, and the
`error.tsx` page) sends `client_error` with the error type, the first line of
the message cut to 120 characters, and `publicPath(location.pathname)`. At
most 5 per page load, and the same message once.

## Alerts

All alerts email through the existing `paddlesnitch-alerts` topic.

| Alarm | Fires when | Notes |
|---|---|---|
| `paddlesnitch-api-errors` | Server errors > 2% of calls over 15 min **and** ≥ 5 errors | New. Metric math over `ApiServerErrors` / `ApiCalls` |
| `paddlesnitch-journey-<name>` (×5) | `fail` > 10% over 1 h **and** ≥ 3 fails | New |
| `paddlesnitch-app-crashes` | Crash reports > 1% of app opens over 24 h **and** ≥ 3 crashes, per platform | New in O3. The one metric with a `Platform` dimension (2 metrics) |
| `paddlesnitch-browser-errors` | `client_error` > 50 in an hour | New. A spike detector, not a rate |
| Existing eight | unchanged | `paddlesnitch-server-errors` stays as the catch-all |

**Severity.** Everything above is "email now". A **daily digest** (one email:
the top API errors, the top crash signatures, new app versions seen, yesterday's
journeys) is phase O4. It needs a small scheduled Lambda that runs Logs Insights
queries.

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
| ~16 new custom metrics (API calls/errors, 10 journey outcomes, app crashes ×2, app opens ×2) | $5/month |
| ~10 new alarms (standard, $0.10 each) | $1/month |
| 3 new dashboards (first 3 per account are free, we already have 3) | $9/month |
| Extra log lines (one per API call) | well under $1/month at today's traffic |
| Logs Insights queries behind dashboard widgets | pennies, while dashboards are opened by hand |

About **$15/month** in total, mostly dashboards. To halve it, merge `-email`
into `-api` and open `-mobile` only once the apps ship (see open decisions).

## Phases

| Phase | What | Touches the apps? |
|---|---|---|
| **O1: server, now** | Move the dashboards into `infra/lib/dashboards.ts` · `clientOf()` · tRPC `onError` + `api_call` lines · journey lines on the five journeys · `paddlesnitch-health` + `paddlesnitch-api` · API and journey alarms | No |
| **O2: contract + ingest** | `mobile/contract/telemetry.md` + fixture JSON for the header, client events and crash report · `/att/api/track` accepts app requests · new allowlisted events · browser error capture · `paddlesnitch-email` | No. Only the contract is written for them |
| **O3: apps adopt** | Android sends the header (one line in its HTTP client) and `app_open`, then crash reports · `paddlesnitch-mobile` + the crash alarm | Yes, when the app agent is ready |
| **O4: digest** | Daily digest email | No |
| **iOS** | Follows the same contract. Nothing new server-side | Yes, when the iPhone app is built |

O1 and O2 only change server and infra files. The one overlap risk is
`infra/lib/att-stack.ts`, which other agents also edit. O1 starts by moving the
dashboard code into its own file in a small PR of its own, so later dashboard
work never touches the stack file.

## Tests

- `clientOf()`: header parsing, unknown platforms → `other`, junk is bounded.
- tRPC `onError`: a thrown procedure writes one `api_error` line with path,
  code and platform, and no input or message. Expected codes aren't counted as
  server errors.
- Journeys: each of the five writes exactly one line per attempt, with the right
  outcome (story-style, e.g. "a trace that misses the start line is an ok
  journey with reason no_crossing").
- `/att/api/track`: app header accepted without an Origin; no header and no
  Origin still dropped; new events allowlisted; crash-report props are bounded
  and stripped to the allowed fields.
- Browser hook: at most 5 per load, deduplicated, path through `publicPath`.
- Infra: dashboards and alarms asserted from the stack source, like
  `ses-delivery-alerts.test.ts`. Each alarm has a minimum-volume condition.
- Contract: the telemetry fixtures validate against their schema in `pnpm test`.

## Open decisions

1. **Per-call log lines (`api_call`).** Log every call (exact rates, more log
   volume) or only errors, and work out rates from Lambda invocations (cheaper,
   rougher, since one invocation isn't always one call)? *Recommendation:* every
   call. Traffic is small, and it can be sampled later.
2. **Dashboard count vs cost.** Six dashboards (about $9/month over the free
   three), or fold `-email` into `-api` and add `-mobile` only when an app
   ships? *Recommendation:* fold email in, and add mobile in O3. That's $6/month.
3. **Crash reporting tool.** Our own next-launch report plus the free store
   consoles (recommended), or Sentry / Firebase Crashlytics from the start
   (symbolicated traces and native crashes, but a third-party SDK and a privacy
   policy change)?
4. **Alert thresholds.** The numbers above are starting guesses. Keep them and
   tune them after two weeks of data?
5. **Digest (O4).** Wanted at all, or is "email only when an alarm fires" enough
   for now?
