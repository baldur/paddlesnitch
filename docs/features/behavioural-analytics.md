# Feature: behavioural analytics — struggle detection via cheap LLM

**Status:** 🚧 spec (2026-08-09). Not built.
**Owner:** Baldur (product), Claude (implementation).
**Apps:** capture in both `att` + `analysis`; ingest + processing in `att` (shared origin, one place).

## Goal

Understand where users get **confused or stuck** — can't find what they were
looking at, hunt around, give up — and turn that into concrete UX fixes. Capture
behavioural signals as they happen, distil each session into a compact **semantic
timeline**, and use a **cheap LLM** (Bedrock Haiku/Nova) to interpret + cluster
the patterns ("users repeatedly can't start an analysis from the library page").

## Non-goals / decisions (chosen 2026-08-09)

- **Custom, in our stack** — no third-party (Clarity/PostHog/etc.); data never
  leaves our infra (capture → our S3 → our Bedrock). Aligns with the platform's
  privacy-forward stance (no HR, hashed emails, no-PII metrics).
- **Semantic struggle-signals only** — NOT raw mouse coordinates and NOT full
  session replay. Cursor paths / rrweb replay are explicitly out (cost, PII,
  and an LLM can't use a coordinate stream anyway).
- **Consent-gated (opt-in)** — capture **nothing** until the user accepts a
  consent banner. This is the strictest posture and keeps it EU/UK-clean.
- **The LLM interprets; it does not detect.** Struggle signals are found by
  deterministic heuristics (client/server). The LLM only summarises + clusters
  the already-distilled timelines — bounding token cost hard.

## Architecture

```
consent granted?  ── no ──▶ capture nothing
      │ yes
      ▼
client capture (att + analysis)         reuse the capture() buffer pattern
  detect struggle signals, buffer,       (analytics.ts): in-memory queue,
  flush a BATCH on timer / size /         flush via fetch + sendBeacon on hide
  pagehide
      │  POST /att/api/behaviour  { sid, consent, events:[…] }   (anonymous)
      ▼
ingest route (att)                       drops if no consent cookie (defence in
  validate + cap + append                 depth); size caps; always 204
      ▼
S3 (data bucket)                         behaviour/{yyyy-mm-dd}/{sid}/{batch}.json
  raw JSONL per session                   lifecycle rule expires after N days
      ▼
nightly reducer + LLM (scheduled Lambda) reduce each session → semantic timeline;
  batch ~20-30 timelines per prompt →      Bedrock Haiku/Nova; write summaries +
  confusion labels + clustered patterns    clustered patterns to S3; emit EMF
      ▼                                     counts (e.g. confused_session)
report (P3)                              protected admin page / S3 JSON reports
```

Everything after capture is **off the request's critical path** (async, nightly)
— it can never slow or break the app, same discipline as the analysis insights.

## Event taxonomy (struggle signals)

Deterministic, well-defined, cheap to detect. Each event: `{ t, type, target?,
path, props? }` where `target` is a **stable element descriptor** (role + label /
`data-analytics-id`, never inner text that could be PII).

| Signal | Heuristic |
|---|---|
| `click` | any click on an interactive element (baseline) |
| `rage_click` | ≥3 clicks within ~700 ms in a ~30 px radius |
| `dead_click` | click on a non-interactive element → no DOM change / navigation follows |
| `error_click` | click immediately followed by a console error |
| `nav` / `back` | route change; `back` = browser back within a short window |
| `pogo_stick` | enter a page → leave within ~2 s back to the previous page |
| `scroll_thrash` | ≥N scroll-direction reversals within a short window |
| `form_struggle` | same field refocused ≥N times, or abandoned after edits |
| `long_dwell` | on a page/section with no interaction for ≥T s then leaves |
| `pageview` | already captured (feeds the timeline) |

Detection lives in a `struggle` module (client) + a server-side sanity re-derive
where cheap. No coordinates are stored — only the signal + element descriptor.

## Privacy & consent (the gating constraint)

- **Opt-in banner.** A `ConsentBanner` (shared `packages/ui`) with Accept /
  Decline. Choice stored in a long-lived cookie `tt_behaviour_consent =
  granted|denied` (site-wide; att + analysis share the domain). Capture is a
  no-op unless `granted`. Declining is remembered (no re-nag).
- **No input values, ever.** We record that a field was interacted with, never
  its contents. Element descriptors use role/label/`data-analytics-id`, not
  free text.
- **Anonymous.** Only the existing random per-tab `sid`; no identity is joined
  in (even for signed-in users) in P1–P3.
- **Retention cap.** S3 lifecycle expires raw behaviour after N days (start 30);
  derived summaries (already aggregate/non-PII) may live longer.
- **Privacy policy + ToS.** Add a behavioural-analytics clause; bump
  `CURRENT_TOS_VERSION` if we decide it's material.
- **Ingest defence in depth.** The route drops events unless the consent cookie
  is `granted`, independent of the client gate.

## Ingest

- `POST /att/api/behaviour` — anonymous, batched `{ sid, consent, events:[…] }`.
  Must be **proxy-exempt** in `src/proxy.ts` (like `/att/api/feedback` +
  `/att/api/track`) or signed-out beacons 307 to auth. Caps: ≤N events/batch,
  ≤M props/event, truncated values; always 204. Analysis app POSTs here too
  (shared CloudFront origin).
- **Origin allowlist** — reuse `isAllowedIngestOrigin` (`src/lib/ingest-origin.ts`,
  shared with `/att/api/track`): drop (still 204) any ping whose Origin/Referer
  isn't one of our own origins. Cheap first line against random/bot pings; the
  header is spoofable, so it is NOT integrity — a determined actor can set it.
  Real integrity would need rate-limiting (CloudFront/WAF rate rule) and/or a
  signed short-lived page nonce; add those only if abuse actually appears.
- Storage via the existing `@paddlesnitch/core/storage` abstraction:
  `behaviour/{date}/{sid}/{batchId}.json`. Append-only; a write error degrades
  silently (never 500 a beacon).

## Reducer + LLM

- **Scheduled Lambda** (EventBridge, nightly). Lists yesterday's `behaviour/{date}/…`,
  groups by `sid`, reduces each to a compact timeline (ordered signals, deduped,
  human-readable), then sends **batches of ~20–30 timelines per Bedrock call**
  (`makeInsighter` pattern; Haiku/Nova via `LLM_MODEL`; IAM already covers
  `bedrock:InvokeModel`) asking for: per-session confusion label + confidence,
  and cross-session **clusters** ("N sessions abandoned the upload flow at the
  file picker").
- Writes results to `behaviour-insights/{date}.json` and emits EMF counts
  (`confused_session`, per-cluster) so trends show on the CloudWatch dashboard.
- **Cost control:** sampling knob (capture % of sessions), batch-per-prompt,
  cheap model, nightly cadence. Log any sampling/truncation (no silent caps).

## Surfacing (P3)

Start with S3 JSON reports + EMF counts on the existing dashboard. Optionally a
protected `/att/admin/insights` page listing the top confusion clusters with
example timelines. No PII to show (timelines are semantic).

## Phasing (each shippable)

- **P1 — consent + capture + ingest + storage.** `ConsentBanner`, the client
  `struggle` capture module (reusing the `capture()` buffer), `POST
  /att/api/behaviour`, S3 JSONL, proxy exemption, lifecycle rule. Mounted in att
  first. No LLM yet — verify events land in S3, gated by consent.
- **P2 — reducer + LLM summaries.** Nightly Lambda: reduce → Bedrock →
  `behaviour-insights/{date}.json` + EMF counts. Batched prompts, cheap model.
- **P3 — clustering + report.** Cross-session pattern clustering + a protected
  admin report (or dashboard widgets).
- **P4 — wire the Analyse app** to the same capture + ingest.
- **P5 — refine signals** from real data (tune thresholds, add/remove signals).

## Infra

- S3 prefix `behaviour/` + lifecycle expiry (extend the existing DataBucket
  `lifecycleRules`, currently 90 d — add a shorter rule for `behaviour/`).
- EventBridge-scheduled Lambda for the nightly reducer (Bedrock IAM already on
  the server role; the new Lambda needs `bedrock:InvokeModel` + S3 read/write on
  the prefix).
- Consent cookie; privacy-policy/ToS copy.

## Testing

- Unit: each struggle heuristic (rage/dead/pogo/thrash/form/dwell) with crafted
  event sequences; the reducer (raw session → expected timeline); consent gate
  (no capture when denied; ingest drops without the cookie).
- Integration: `POST /att/api/behaviour` batch → S3; proxy exemption regression.
- The LLM step uses the deterministic-fallback discipline (never blocks; a bad
  batch is skipped, logged).

## Open questions

- Sampling rate to start (100% of consenting sessions, or a %)?
- Retention days for raw behaviour (30 vs 60)?
- Is behavioural capture material enough to bump the ToS version, or a
  privacy-policy line + consent banner sufficient?
- Report surface: S3 JSON only to start, or the admin page in P3?
