# Performance: assemble once, always fresh

📋 **Proposal, 2026-10-08.** Phase 1 is built as a draft PR (https://github.com/baldur/paddlesnitch/pull/384); nothing else here is built yet, except where it says
so. The measurement side (a check after every deploy and the
`paddlesnitch-performance` dashboard) shipped in #383.

## In one paragraph

The site is already quick when it's warm: the median server request takes
**27 ms**. What makes it feel slow is four things, in this order:

1. **Round trips before anything shows.** The signed-in pages render empty,
   then ask who you are, then ask for your data.
2. **Cold starts.** One request in ten lands on a sleeping server and waits
   about 0.66 s for it to start.
3. **Reading far more than we show.** BOAT MOTION reads 2.2 MB to draw 40 KB of
   charts, every time. Until #379 the paddle list read 6.5 MB.
4. **Listing everything to find something.** For example, finding your tracker
   recordings reads every user's recordings.

The CPU work itself is small: a whole hour's boat-motion analysis is 26 ms.
So the plan is not a faster language. It's:

- never compute or assemble the same thing twice;
- key every saved result by the versions of what it was made from, so it
  can't go stale;
- put the data in the first HTML;
- keep one server warm.

At today's traffic all of that costs **under $1 a month** without the always-on
server, or about **$12 a month** with it. **ElastiCache is the wrong tool at
this size:** about $45 a month before it holds anything, once the network it
needs is paid for.

## What I measured (2026-10-07/08)

**Server** (Lambda: Node 22, x86, 1 GB, one function for everything; last 7
days, 12,340 requests):

| | p50 | p90 | p95 | p99 |
|---|---|---|---|---|
| all requests | 27 ms | 694 ms | 802 ms | 2,782 ms |
| warm only | | | 391 ms | |
| cold starts (9.6% of requests) | | | 1,544 ms | |

A cold start adds **661 ms on average** (worst 1,039 ms) before the request
even begins.

**CPU**, on the 13 Sep paddle (65 min; 612 KB track, 1.6 MB motion at 10 Hz;
laptop, warm):

| step | time |
|---|---|
| parse the track | 5 ms |
| analyse (efforts, splits) | 2 ms |
| diagnostics | 7 ms |
| stroke rate, session | 15 ms |
| stroke rate through the paddle | 20 ms |
| boat motion | 26 ms |

A Lambda with 1 GB has about 0.6 of a CPU, so these might be 3–5× slower
there. That's still **under 0.4 s for everything at once**, and nothing needs
it all at once.

**Reads.**
- **BOAT MOTION** reads the whole track and motion file (2.2 MB) and recomputes
  everything on **every view**.
- **The paddle list** was 6.5 MB, read twice (fixed in #379: 0.19 s from a
  laptop).
- **The Trials home page** was 2.2 s, from reading every entry one by one
  (fixed in #380: 0.33–0.69 s).

**Browser.**
- Every page loads about **600 KB of JavaScript (180 KB compressed)** for
  modern browsers, two thirds of it React and the Next runtime. A further
  109 KB polyfill is skipped by modern browsers.
- Built files now get "keep for a year" (#381).
- **The signed-in pages build themselves in the browser:** HTML, then
  JavaScript, then "who am I?" (`me`), then the data, then the map tiles.

**Data size today:** 179 tracker objects (40 MB), 150 paddle objects (8 MB), 70
trial objects (1.5 MB). Small, so the list-everything pattern costs tens of
milliseconds now. But it grows with every user, not with you.

## The mental model

> The server should only have to calculate or assemble the same data once, but
> always include the latest, no exceptions.

Two mechanisms, and every speed-up below is one of them.

### 1. Assemble on write (materialised views)

Whoever changes data also updates the small things that summarise it, at
the same moment:
- a paddle's `summary.json` (#379);
- a trial's `leaderboard.json` (already);
- an index such as "this user's recordings".

Reads then touch one small object instead of scanning many.

- **Fresh** because the writer updates both. A test forbids writing the
  source any other way; #379 has one for paddles.
- **Best for:** lists, totals, indexes. Anything many pages read and few
  actions change.
- **Watch:** two writers at the same moment can each update the view from a
  stale read. Keep views per object (`summary.json` per paddle), not one
  shared file, or use a store with conditional writes (DynamoDB).

### 2. Version-keyed derived values (compute on read, once)

A derived value's storage key **includes the versions of everything it was
made from**, plus the code version:

```
derived/u/{userId}/boat-motion/v{code}/{hash(recordingVersion, motionVersion)}.json
```

- **On read:** work out the key from versions you already have (a recording's
  metadata says when its motion data landed). Get it. On a miss, compute,
  store, return.
- **On change:** nothing to invalidate. New input means a new version, which
  means a new key, so the next read recomputes. Old copies are simply never
  read again, and a lifecycle rule deletes them after 30 days.
- **Code version:** bump it when the algorithm changes. The safe default is the
  deploy's commit, which recomputes everything once per deploy; that's cheap
  at our size. An explicit number per computation saves the recompute, but
  someone has to remember to bump it, so it's opt-in, with a test that the
  algorithm's file hash matches the recorded version.
- **Best for:** expensive, rarely-changing results such as boat motion,
  stroke-rate series, section matching and course records.

**Rule of thumb:**
- Read by many pages, changed by few actions: assemble on write.
- Expensive and per-item: version-keyed.
- Cheap: just compute it.

### Security (non-negotiable)

- **Private derived values live under the owner's prefix** (`derived/u/{userId}/…`),
  are only ever read after the same permission check as their source, and
  are deleted by account erasure (one more line in the erasure route and in
  `account-data-complete.test.ts`).
- **Never cache anything that depends on who is looking.** Cache the
  viewer-independent part and apply the permission filter after reading.
  Profile stats and course records are filtered per viewer today; they'd
  cache "all results" and filter on the way out.
- **The cache key never carries anything secret.** Hashes of versions only, no
  tokens, no emails.
- **Public caches** (CloudFront, Next's page cache) are only for pages that are
  identical for everyone.

## One interface, swappable backends

```ts
// packages/core/src/derived.ts (proposed)
derived<T>(
  spec: { name: string; owner: string | 'public'; inputs: VersionToken[]; code?: string },
  compute: () => Promise<T>,
): Promise<T>
eraseDerived(owner: string): Promise<void>
```

Behind it, layered, all with the same keys:

| layer | what | cost | latency | notes |
|---|---|---|---|---|
| L1: memory in the warm Lambda | Map, size-capped | free | ~0 ms | Lost on cold start. Safe because keys are versioned. |
| L2: S3 (default) | `derived/` prefix in the data bucket | ~$0.0004 per 1,000 reads | 20–60 ms | Already there, no network changes. Lifecycle rule 30 days. |
| L2 alternative: DynamoDB | items ≤ 400 KB | $0.14 per million reads | ~5 ms | Worth it if hit rates get high. No VPC. |
| L2 alternative: ElastiCache (Valkey) | in-memory | see below | <1 ms | Only if we outgrow S3 and DynamoDB. |

Pages and procedures only ever call `derived()` and the view writers, so the
store underneath can change without touching them. The existing `storage`
module already works this way for S3 vs local files.

## Storage and caching options, priced

eu-west-1 on-demand prices, from the AWS Pricing API (2026-10-08):

| option | fixed monthly | per use | extra requirements | verdict |
|---|---|---|---|---|
| **S3 for derived values** | $0 | GET ~$0.0004/1k, PUT ~$0.005/1k | none | **Start here** |
| DynamoDB on-demand | $0 | $0.1415 per M reads, $0.705 per M writes, storage ~$0.28/GB | none (public endpoint, IAM) | **Later, if S3 stops being enough** (decision 2: stay on S3) |
| ElastiCache Serverless Valkey | ~$6.90 (100 MB minimum at $0.094/GB-h) | $0.0025 per M ECPU | **Lambda in a VPC → NAT gateway $35/month + $0.048/GB** (we call Strava, Open-Meteo, EA, GitHub, Bedrock, SES, Cognito) | **~$42+/month** before it stores anything. Not yet |
| ElastiCache t4g.micro Valkey | $9.93 | – | same VPC and NAT | ~$45/month. Not yet |
| CloudFront caching of public pages | $0 | already paying per request | Next's page cache (OpenNext: S3 + DynamoDB tags) | **Yes**, for fully public pages |

**When would ElastiCache earn its keep?** When we need sub-millisecond shared
state at hundreds of requests a second: rate limits, live sessions, presence.
That's not now. DynamoDB gives single-digit milliseconds without a VPC. And our
measured problem is round trips and bytes, not 5 ms lookups.

## The opportunities, ranked

Each row says what it fixes, the expected gain, the cost, and the trade-off.

### A. Put the data in the first HTML (biggest felt win)

**Today:** Paddles, a paddle and Devices render empty. The browser then asks
"who am I?", then asks for the data. That's two round trips after the
JavaScript loads, each 100–300 ms on a phone, plus a cold start if the server
was asleep.

**Change:**
- The server fetches the data while rendering (the tRPC `createCaller` we
  already use for SSR elsewhere) and hands it to the client cache, so the HTML
  arrives with the list or the paddle in it.
- The header gets the signed-in user from the server, so there's no `me`
  request on every page.

| | |
|---|---|
| Gain | ~0.3–0.8 s off "something useful on screen" on a phone |
| Cost | $0 |
| Trade-off | The page waits for the data before sending anything. Streaming with Suspense sends the frame first. Keep the client query for refreshes. |

### B. Boat motion and diagnostics computed once

Version-keyed on the recording's and the motion file's upload times. Also
computed **on upload** (in `after()`), so even the first view is a hit.

| | |
|---|---|
| Gain | each BOAT MOTION view goes from reading 2.2 MB and computing to reading ~40 KB |
| Cost | pennies |
| Trade-off | One more stored artefact per recording, private, expiring and erasable. |

### C. Keep one server warm

| option | gain | cost/month | trade-off |
|---|---|---|---|
| A warmer (EventBridge pings every 5 min; OpenNext has one built in) | most of the 10% cold starts go away for single-user traffic | ~$0.10 | A burst of parallel requests still starts new instances. |
| Provisioned concurrency ×1 (1 GB) | no cold start for the first concurrent request, guaranteed | **$12.05** | Real money relative to today's bill. |
| ARM (Graviton) | −20% per ms; init usually as fast or faster | saves | Needs a check that no native module breaks (sharp is in the image function, not this one). |
| Slimmer server bundle (34 MB today) | shorter init | $0 | Takes some digging: what makes 34 MB? |

Decided: warmer + ARM now; review the cold-start chart after one to two
weeks; provisioned concurrency only if cold starts still hurt.

### D. Stop listing everything (indexes)

**Today:**
- tracker recordings: every user's are listed and read;
- trials: every key under `trials/`, entries and traces included, is listed;
- the same for courses, groups and profile stats.

**Change:** per-owner and per-parent indexes written on change, for example
`users/{id}/recordings.json` and `courses/{id}/trials.json`.
- **As S3 objects (decided).** One object per item where possible, and S3
  conditional writes (`If-Match`) with a retry for shared ones, so two
  writers can't overwrite each other.
- **A DynamoDB table** (queries by owner, about $0/month) stays the next step
  if S3 stops being enough.

| | |
|---|---|
| Gain | flat request time as users grow |
| Cost | ~$0–1/month |
| Trade-off | a second datastore to operate, plus a migration script (dry run first, like the others); local dev keeps a file-backed fake behind the same interface |

This is the real "database decision". Today it isn't hurting; it will, at
some number of users we don't control.

### E. Public pages from CloudFront

**Today:** `/guide`, `/help`, `/privacy`, `/terms` are prerendered but still
hit the server on every request: Next's page cache is switched off
(`open-next.config.ts`: `incrementalCache: 'dummy'`), and the default
behaviour has caching disabled.

**Change:** turn on OpenNext's S3 page cache and let CloudFront cache fully
public pages. OpenNext's tag cache needs DynamoDB, and decision 2 keeps us on
S3, so freshness comes either from time-based revalidation or from a
CloudFront invalidation when a write changes the page. The pages:
- the guide pages;
- the legal pages;
- signed-out Trials pages, with `revalidateTag` when an upload rebuilds a
  leaderboard.

| | |
|---|---|
| Gain | those pages served from the edge in ~20 ms, no server at all |
| Cost | ~$0 |
| Trade-off | the trickiest one to get right. A page cached for everyone must never contain anything personal. The header's account menu must render in the browser on cached pages, and a cookie must bypass the cache. Needs a spike and a test that no cached response varies by cookie. |

### F. Adding a paddle: don't wait for the AI summary

**Today:** ADD A PADDLE waits for the weather (up to 4 s) and the AI summary
(up to 12 s) before showing anything.

**Change:** save straight away with the plain summary, open the paddle, and
write the AI summary in `after()`; the page picks it up when it lands.

| | |
|---|---|
| Gain | the paddle opens in about 1 s instead of 5–15 s |
| Cost | $0 |
| Trade-off | the summary changes a few seconds after the page opens; say so on the page ("writing your summary…") |

### G. Less JavaScript

- **Today:** 180 KB compressed per page, two thirds of it the framework.
- **Change:** move the always-on extras out of the first load:
  - the cookie notice (only until accepted);
  - the feedback widget (only when opened);
  - the analytics pump;
  - the tRPC client on pages that don't use it.
- **Gain:** perhaps 30–50 KB compressed; measure with the bundle analyser first.
- **Trade-off:** small gains for effort; the framework floor stays.

### H. Bigger server

1 GB gives about 0.6 of a CPU; 1,769 MB gives a full one. CPU-bound steps get
1.7× faster at 1.7× the price per millisecond, so the cost is roughly flat
for CPU work and dearer for waiting on S3. **Try it once B and D are done**,
and keep it only if the dashboard shows a gain.

## Rust, C, WebAssembly?

**Short answer:** not for the server, not now. Maybe one day for one thing.

- **CPU isn't the bottleneck.** The heaviest step is 26 ms (boat motion,
  laptop). After B it runs once per recording, not per view. A 3× faster
  language would save tens of milliseconds, once.
- **Rust's real advantage on Lambda is cold start** (~20–50 ms against Node's
  660 ms). But the web server is Next.js, which is JavaScript. A Rust rewrite
  means leaving Next, React and server rendering: a different product to
  build and maintain. The warmer gets most of the cold-start win for $0.10.
- **Where it could make sense later:**
  1. **The tracker API** (`/api/devices/*`): small, stable, called in bursts
     (37 chunk uploads per sync). A separate small function, Rust or just a
     slim Node bundle without Next, would start fast and keep device traffic
     off the web server.
  2. **On the tracker or in the browser:** the same stroke-rate and
     boat-motion code, compiled from one Rust source to the tracker's ESP32
     (C ABI) and to WebAssembly for the Bluetooth page. Live stroke rate on the
     device was already a later phase of the Bluetooth spec. That's where one
     shared, fast implementation pays off.
- **Cost of doing it:**
  - a second language and toolchain;
  - harder debugging;
  - WebAssembly builds in CI;
  - fewer people who can change it.

  **Recommendation:** a slim Node tracker API first, if device traffic ever
  shows up on the dashboard; Rust only for the shared on-device/in-browser
  algorithms, when live stroke rate is actually built.

## Proposed order

| phase | what | expected gain | cost/month | risk |
|---|---|---|---|---|
| 1 | B (boat motion once) + the `derived()` interface with S3 + L1 | BOAT MOTION ~instant; the pattern in place | ~$0 | low |
| 2 | A (data in the first HTML) for Paddles, a paddle, Devices; header user from the server | 0.3–0.8 s on phones | $0 | low–medium |
| 3 | C (warmer + ARM); review cold starts after 1–2 weeks | most cold starts gone; −20% compute cost | ~$0.10 | low |
| 4 | F (paddle opens before its AI summary) | add a paddle 5–15 s → ~1 s | $0 | low |
| 5 | D (indexes as S3 objects, conditional writes) | flat with growth | ~$0 | medium |
| 6 | E (public pages from the edge) | ~20 ms public pages | ~$0 | medium (privacy care) |
| 7 | G, H as measured | small | ~$0 | low |

Each phase is one or two PRs, measured before and after on the
`paddlesnitch-performance` dashboard (#383), and revertable on its own.

## Guardrails (tests that keep it true)

- **Freshness.** For every `derived()` use, a test changes each input and
  checks the result changes. A test also checks the key includes every input.
- **One writer.** Each assembled view has a test forbidding other writers of
  its source (as #379 does for paddles).
- **Privacy.**
  - Derived keys for private data are under the owner's prefix.
  - Erasure deletes `derived/u/{id}/`.
  - No cached public response varies by cookie.
- **Budgets.** The performance check (#383) has per-page budgets. Once signed-in
  timing exists, with a test account, add Paddles and a paddle with tight
  budgets.

## Decisions (owner, 2026-10-08)

1. **Cold starts: the warmer first.** Review the cold-start chart on the
   `paddlesnitch-performance` dashboard after one to two weeks. Provisioned
   concurrency ($12/month) only if it still hurts.
2. **Stay on S3.** No DynamoDB for now, to keep one datastore. Indexes and
   views are S3 objects, made safe with concurrent writers by:
   - one object per item where possible (`summary.json` per paddle);
   - S3's conditional writes (`If-Match` on the ETag read) for shared ones,
     retrying on a conflict.

   DynamoDB stays the documented next step if S3 stops being enough.
3. **Code version: the deploy's commit.** Every deploy recomputes derived
   values once. Explicit per-computation versions only for something
   expensive and stable, with a test tying the version to its code.
4. **A test account for the performance check**, so it times the signed-in
   pages and the data behind them too.
