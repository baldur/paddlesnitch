# Telemetry: what the apps tell the server

How the Android and iPhone apps report which app they are, that they started,
and that they crashed ([`docs/features/observability.md`](../../docs/features/observability.md)).
Nothing here identifies a person: no user id, no install id, no exception
messages, no file paths. Fixtures in `fixtures/telemetry/` are replayed against
the real endpoint by `pnpm test` (`apps/web/src/tests/telemetry-contract.test.ts`).

## 1. One header on every request

This is the header the apps **already send** for sign-in (see "Signing in" in
the README). It makes sign-in answer with tokens, and it tells the server
which app sent the request. Send it on **every** request: tRPC, uploads,
sign-in and telemetry.

```
x-paddlesnitch-app: <platform>/<version>
x-paddlesnitch-app: <platform>/<version> (<build>)
```

| Part | Value |
|---|---|
| `platform` | `android` or `ios` |
| `version` | the user-facing version, 1–4 dot-separated numbers: `0.1.0` |
| `build` | the store build number, digits only: `42`. Optional, with its brackets |

Examples: `android/0.1.0`, `ios/1.0.0 (7)`.

Anything else is counted as platform `other`, so a typo shows up as "other"
on the dashboards rather than as the app. Android already sends it on every
call (`Api.call`). iOS sends it on sign-in calls; it needs to go on every
request. With the header alone, every API call and every key action (sign in,
upload, tracker sync) is split by platform and version
server-side.

## 2. Events: `POST /att/api/track`

The same endpoint the web site uses, sent with the header above (the apps
send no `Origin`, and the header is what lets them in). The answer is always
`204` with no body, whatever happens. Fire and forget, and never retry in a
loop.

```json
{
  "sid": "<random id, new each app start, at most 64 chars>",
  "events": [
    { "event": "app_open", "t": 1761380000000, "path": "app:paddles" }
  ]
}
```

- `event`: one of the events below. Anything else is dropped.
- `t`: when it happened, epoch milliseconds. Optional. Up to 14 days old is
  accepted (a report queued while offline still lands on the right day).
- `path`: optional, at most 200 chars. Use `app:<screen>`, never a URL with ids
  in it.
- At most 100 events per request.
- `platform`, `appVersion` and `build` are taken from the header. Props with
  those names are ignored.

### `app_open`

Once per cold start, after the first screen is shown. It's the denominator of
the crash rate. No props.

### `crash_report`: sent on the next start

1. Install an uncaught-exception handler (Android:
   `Thread.setDefaultUncaughtExceptionHandler`, then call the previous handler;
   iOS: `NSSetUncaughtExceptionHandler` plus a signal handler for
   `EXC_BAD_ACCESS`-type crashes). In it, write one small file with the fields
   below, then let the crash continue.
2. On the next start, if the file exists, send one `crash_report` and delete
   the file **whether or not the send worked**. A crash is reported once or not
   at all, never in a loop.

| Prop | What | Rules |
|---|---|---|
| `type` | exception class or signal: `java.lang.IllegalStateException`, `EXC_BAD_ACCESS` | required; no spaces |
| `frames` | **your own** stack frames, top first, joined with `\|`: `com.paddlesnitch.paddles.PaddleScreen.render:212` | at most 12; `Class.method:line` only, no file paths, no spaces. Leave out system frames above your own |
| `appVersion` | the version that **crashed** (it can be older than the one reporting) | `1.0.3` |
| `build` | the build that crashed | digits |
| `os` | `Android 14`, `iOS 18.1` | letters, digits, spaces, dots |

Never include the exception **message**: it can contain user data.

The server builds `signature` = `type @ first frame` for grouping, and drops
any frame that doesn't look like `Class.method:line`. A report without a valid
`type` is dropped.

Native crashes this can't catch (ANRs, out of memory, crashes in native code)
are covered by the stores' own consoles: Google Play's Android vitals and App
Store Connect's crash reports.

## Fixtures

| File | Shows |
|---|---|
| `fixtures/telemetry/app-open.json` | an `app_open` from Android |
| `fixtures/telemetry/crash-report.json` | an Android crash reported by the next version |
| `fixtures/telemetry/crash-report-ios.json` | an iPhone crash |

Each fixture has the request `headers`, the `body` (`"{{now}}"` stands for the
current time), and the `emits` lines the server must log for it.
