# Security, privacy and resilience audit — September 2026

**Status:** audit done 2026-09-28/29. Clear-cut fixes are PRs #303–#320; the owner's
decisions on the rest (2026-09-29) added #322–#324 and are noted under each decision.
All of them were merged and deployed on 2026-09-29 except **#316** (firmware 0.16.5),
which stays a draft until it has been run on a tracker. The rest needs decisions, listed under **Decisions** with
the trade-offs and a recommendation. Budget constraint throughout: this stays
cheap infrastructure (today ~$30–50/month for the whole shared AWS account).

**How:** four read-only reviews of the code and specs (tracker firmware and device
auth; web and cloud security; privacy and data handling; resilience and
debuggability), then the live AWS account was checked read-only (bucket settings,
log retention, alarms, budgets, Cognito, Lambda URLs, SES, costs). Every finding
below was checked against the code or the live account before it was acted on.

---

## Read this first

1. **Email to testers doesn't work.** SES in eu-west-1 is still in the **sandbox**:
   production access was requested and **DENIED** (case 178023180500470). In the
   sandbox SES only delivers to verified addresses (paddlesnitch.com and your
   Gmail). So for testers **EMAIL CODE sign-in, "Forgot password", and group
   invitations never arrive**. Password sign-up (no email) and Strava sign-in work.
   The guide currently offers EMAIL CODE as an option. See Decision 1.
2. **Merge order.** #304 first and let its deploy finish, then #305 (the AWS trust
   change is two steps). #316 is a draft until it has been on a tracker. The others
   are independent; small conflicts are possible in `infra/lib/att-stack.ts`
   (#309/#310/#311) and `deploy.yml` (#305/#319) — rebase as you go.
3. **Before handing out trackers** (after #306): remove paddle02–05 from your
   Devices page, or testers get "This tracker is on someone else's account".
   Also see Decision 6: a factory reset leaves your recordings on the card and
   they upload into the tester's account.
4. **After merging, one-off steps:**
   - #308: run `scripts/strip-trial-traces.ts --apply` (2 Garmin zips in prod).
   - #309: confirm the SNS subscription email; optionally test an alarm.
   - #307: rotate the submit link on any trial that has one (it was readable).
   - #315: turn on Dependabot alerts + security updates (Settings → Code security).
   - Check `main` is branch-protected against the Actions token (my token can't read it).
   - Delete the first tracker's leftover device token (from the paddle03 ID clash).

---

## Fixed (PRs)

| PR | What | Why it mattered |
|---|---|---|
| #303 | Storage lists every page of keys; only "not found" reads as missing | Past ~250 recordings / ~450 entries, trackers, recordings, export and erasure silently missed data; a throttled read overwrote group lists, handles, leaderboard entries |
| #304, #305 | Only `environment: production` jobs can assume the AWS deploy role; fast loop only reacts to repo members | The AdministratorAccess role trusted every workflow on main, including Claude jobs run by anonymous public issues with Bash and `id-token: write` |
| #306 | No tracker takeover; re-adding cancels old tokens; token not rewritten per request; limits fit the tracker; code guesses limited | Anyone knowing a deviceId could take a tracker's record; old tokens never died; a waiting tracker was locked out after ~25 min |
| #307 | Trial `submitToken` and invite list only for managers | The token bypasses the participation gate and was in the public JSON |
| #308 | Time-trial entries keep the parsed track, not the uploaded file | "Heart rate is never stored" was false: the raw GPX/FIT/zip was kept |
| #309 | Bucket versioning (30 days), deletion protection, 90-day log retention, 6 alarms + SNS, $75 budget | No backup, nothing deletion-protected, logs forever, no one told about errors |
| #310 | Lambdas on Node 22 | Node 20 is end-of-life; AWS will block deploys to it |
| #311 | Security headers (HSTS, frame DENY, nosniff, referrer) | None were sent; account-delete could be clickjacked |
| #312 | Safe `next=`; 5 codes/resets per email per hour; crypto sign-in codes | Open redirect after sign-in; inbox flooding / SES cost; `Math.random` codes |
| #313 | Zip inflation capped; link import https-only, no internal hosts, no redirects, timeout, size cap | Zip bomb could kill the Lambda; SSRF to the Lambda runtime API |
| #314 | Strava deauth confirmed with Strava first | Anyone could disconnect any user's Strava (public endpoint, public ids) |
| #315 | Dependabot | Nothing watched dependencies |
| #316 *(draft)* | Firmware 0.16.5: setup page escaped, no Server field, Amazon Root CA 1–4, LoRa off, 128-file upload cap, checksum retry | XSS on the setup page; point-a-tracker-elsewhere; a certificate change could brick OTA; live position broadcast; card full of uploaded files blocked new ones |
| #317 | Share ids, handles, tracker ids, claim codes out of analytics and public issues | A report from a shared paddle published its link (full route) on GitHub |
| #318 | Timeouts on Strava, GitHub, Cognito JWKS | A slow service held requests to the 30 s limit |
| #319 | One deploy at a time; smoke test after deploy | Quick merges left main undeployed; breakage found by users |
| #320 | Privacy page: all cookies, IP records, Gmail forwarding, AI inputs | The page understated what's collected and where it goes |

Tests were added with every PR (unit, route, and source-scanning tests that pin
infrastructure and firmware settings).

---

## Decisions

Each: the situation, the options, a recommendation, and rough cost.

### 1. Email (SES) — sandbox, and a $15/month dedicated IP
- **Situation:** production access DENIED; a *managed dedicated IP pool*
  (`paddlesnitch_ip_pool`) costs ~$15/month — half the account's bill — and isn't
  needed at this volume. VDM is also on.
- **Options:** (a) re-apply for production access with a clear description
  (transactional only: sign-in codes, resets, invites; bounce/complaint handling —
  #309 adds a bounce alarm); (b) until then, tell testers to use password sign-up
  or Strava and drop EMAIL CODE from the guide; (c) delete the dedicated IP pool
  and turn VDM off.
- **Recommend:** all three. (b) today, (a) this week, (c) unless another project uses them.

### 2. Claude intake on anonymous issues
- **Decided (2026-09-29):** keep it running with restricted access → #324 (read and comment only; fixing is a maintainer-started fast-loop run; action pinned).
- **Situation:** after #305 it can't reach AWS, but it still runs on text anyone
  can submit, with Bash and `contents: write` — a prompt injection could push a
  branch, open PRs, or leak the Claude OAuth token.
- **Options:** (a) keep automatic, but drop Bash/Write for intake (read + comment
  only), and let a human's `claude-go` label start the fixing run; (b) human
  label for everything; (c) leave as is.
- **Recommend:** (a). Also pin `anthropics/claude-code-action` to a commit SHA,
  and protect `main` (require PRs, no bypass for Actions).

### 3. Deploy role is AdministratorAccess
- **Recommend:** scope it to assuming the CDK bootstrap roles (`cdk-hnb659fds-*`),
  and give firmware release its own role that can only write `firmware/*`. Then
  deny the web Lambda writes under `firmware/` (today a web-app bug that writes
  to S3 could become firmware on every tracker). ~2–3 h, $0.

### 4. Tracker secrets — "should the device have a special certificate?"
- **Today:** a per-device random bearer token (256-bit, stored hashed server-side,
  revocable) over TLS to Amazon's roots. That is sound. A per-device *client
  certificate* (mTLS) would add provisioning and a CA to run, and CloudFront
  doesn't do mTLS to the origin cheaply — it buys little over the token.
- **The gaps are elsewhere:** the token **never expires**, and everything on the
  tracker (token, WiFi password) sits in plain flash that `esptool read_flash`
  reads with a USB cable.
- **Options:** (a) token expiry + rotation (server hands out a new token near
  expiry; OTA-deliverable; ~½ day); (b) ESP32 flash encryption + secure boot —
  burns eFuses, one-way, cable-only, a mistake bricks a board.
- **Recommend:** (a) now; (b) not for the beta — revisit before selling trackers.

### 5. "Should things be signed?" — firmware
- **Today:** the tracker checks the image's sha256 from the manifest over TLS.
  That proves integrity, not origin: whoever can write the bucket (deploy role,
  web Lambda, any commit on main) can ship firmware to every tracker.
- **Options:** app-level **ed25519 signing** — a public key in the firmware,
  a private key held outside AWS (a GitHub secret on a protected environment, or
  offline); OTA-deliverable, ~1 day. Secure boot v2 is the eFuse version (cable).
- **Also:** (i) `otaMarkValid()` only checks local hardware, so a build that boots
  but can't reach the network strands trackers — mark valid only after a
  successful server round trip; (ii) Arduino marks the image valid before
  `setup()`, so the bootloader rollback only covers very early crashes — define
  `verifyRollbackLater()`; (iii) a `beta` channel for 24 h before stable once
  testers can't reach a cable.
- **Recommend:** signing + (i) + (ii) before testers are far away; (iii) when there
  are more than a handful of trackers.

### 6. "Should data on the device be encrypted?" — the SD card
- **The real problem:** a factory reset keeps the recordings on the card (the
  screen says so), and on the next account **they upload into the new owner's
  account** — your paddles would land in a tester's Paddles. Anyone holding a
  tracker can also read the card (pull it, or serial `CAT`).
- **Options:** (a) factory reset also wipes the card (with a clear confirmation);
  (b) server refuses recordings that started before the tracker was linked to the
  current account; (c) encrypt files with a key in flash (only meaningful with
  flash encryption, see 4).
- **Recommend:** (a) + (b) before the hand-out; wipe the cards by hand for this
  batch regardless. (c) no.

### 7. "Should the data on paddlesnitch be encrypted more?"
- **Today:** S3 encrypts everything at rest (SSE-S3); #309 refuses plain-HTTP
  access. Device tokens and claim secrets are hashed. **Strava tokens are
  plaintext JSON** in S3.
- **Options:** (a) KMS customer key for the bucket (~$1/month + requests): adds a
  key policy and CloudTrail record of every decrypt, not much else for a single
  app role; (b) encrypt Strava tokens field-level with a KMS key; (c) CloudTrail
  S3 data events on personal-data prefixes (who read what; a few £/month).
- **Recommend:** (b) and (c) when there are real users beyond testers; (a) no.

### 8. Redundancy (cheap)
- **After #309:** 30 days of object versions protect against bugs and bad deploys,
  but not against account compromise or someone with admin deleting the bucket.
- **Options and cost:**
  | Option | ~$/month | Protects against |
  |---|---|---|
  | Nightly `s3 sync` to Backblaze B2 / Cloudflare R2 from a GitHub Actions cron, write-only key (both have 10 GB free) | $0–0.10 | account compromise, deploy-role misuse, region loss |
  | Nightly Cognito user export (sub, email, name, attributes) into that copy | $0 | losing the pool: every S3 key is a Cognito `sub` |
  | Replication to a bucket in a *second AWS account* with Object Lock (30 days) | ~$0.10–0.50 | same, all-AWS |
  | Cross-region replication | ~$0.05–0.60 | region outage |
  | Uptime check (Actions cron curl every 15 min) | $0 | nobody noticing a full outage |
- **Recommend:** the B2/R2 copy + Cognito export + uptime cron (~$0). Write the
  restore runbook at the same time (pool rebuild must also replay the
  hand-added `custom:auth_preset` attribute and SES rule-set activation).

### 9. The origin can be called directly
- **Situation:** the Lambda function URLs are `authType NONE`, so requests can skip
  CloudFront (and its headers), and the per-IP rate limit reads a spoofable
  `X-Forwarded-For`.
- **Options:** (a) CloudFront adds a secret header, the app 403s without it —
  secret from SSM at deploy time, never in the repo; (b) CloudFront OAC for Lambda
  URLs (IAM auth) — cleaner, but browser POST bodies need a payload hash header.
- **Recommend:** (a), then take the client IP from CloudFront's viewer-address header.

### 10. Sign-up doesn't prove the email
- **Decided (2026-09-29):** not now. Revisit if abuse shows up (e.g. accounts registered with other people's addresses, or invitation theft).
- **Situation:** password sign-up marks the email verified without a code. Someone
  can register *your* address first (then share the account if you later sign in
  by code), and — worse — **pending group invitations to that address are applied
  to whoever signs up with it**, admin invitations included.
- **Recommend:** confirm the email with a code at sign-up (the OTP flow exists) and
  apply invitations only after that. ~½ day. Also make only `name` writable by
  users in the Cognito client (today `email` and `custom:auth_preset` are).

### 11. Terms of Service on every sign-up path
- **Decided (2026-09-29):** yes → #323 (accept at sign-in for email-code and Strava accounts and anyone on an older version). No age question added.
- **Situation:** only the password sign-up tab has the ToS box. EMAIL CODE and
  Strava create accounts without it, there is no age declaration anywhere, and
  nobody from v001 has accepted v002 (the "re-accept gate" doesn't exist). The
  ToS age line cites a 16 threshold; the UK figure is 13 and applies to consent.
- **Recommend:** one gate page — any signed-in request without the current version
  goes to "accept + confirm you're 16 or over". ~1 day.

### 12. Account deletion deletes other people's results
- **Decided (2026-09-29):** it shouldn't → #322 (only trials/courses with no group and nobody else's results are deleted).
- **Situation:** erasure deletes every trial and course the user *created*, including
  **other paddlers' entries**, even though groups own them now and the group
  itself passes to an heir. It also runs as one long sequence in a 30 s Lambda.
- **Recommend:** delete the user's own entries everywhere, and only trials/courses
  with no group; group-owned ones stay with the group. Make erasure resumable.

### 13. Shared paddle links show where you live
- **Decided (2026-09-29):** no trimming: people generally paddle from a club, not from home.
- **Situation:** a shared paddle publishes the full route including start and end;
  many paddles start at home.
- **Recommend:** trim the first and last ~400 m on the shared view and the share
  image by default, with an owner switch to show all. ~1 day.

### 14. Things kept forever
- Failed-upload diagnostics, abandoned tracker upload parts, pending invitations
  (with the invitee's email), inbound privacy@ mail, beta applications, feedback
  contacts, and the privacy@ → Gmail copies.
- **Recommend:** lifecycle rules (parts 7 days; failed uploads 90 days; pending
  invitations 60 days; inbound mail 1 year) — needs a couple of prefixes moved;
  a calendar date to delete beta applications; consider an EU mailbox instead of
  Gmail. ~½ day.

### 15. Smaller ones
- **CSP** header: worth doing, needs testing against Leaflet/Esri, Strava images,
  fonts and Next's inline scripts.
- **`pnpm audit` gate in CI**: would block deploys on any new advisory; Dependabot
  (#315) is enough for now.
- **Cost abuse**: per-user daily limits on analysis/AI summaries/section insight and
  on group invitations (free accounts can be created at will).
- **Race conditions**: JSON read-modify-write everywhere (groups + member index,
  trial metadata, device record). An `updateJson` using S3 conditional writes
  (`If-Match`, free) would stop lost updates. ~1 day.
- **Tracker diagnostics**: the server doesn't know a tester's reset reasons, SD
  state, or why uploads fail. Cheap design: record rejected uploads per tracker
  (server-only), then a small hourly-limited diagnostics upload with the flight
  recorder tail, signalled like OTA. ~2–3 days total.
- **Crew names** on public leaderboards are typed by someone else (possibly
  juniors). Consider initials on public trials.
- **Committed real GPS data** in this public repo:
  `firmware/data/track_0039.csv` (a real fix near Reading) and the Garmin zip
  fixture. If either is someone's home area, replace with synthetic data and
  consider rewriting history.
- **Bedrock** calls are bounded by a timeout that doesn't abort the SDK call
  (a slow model keeps running and billing).
- Leftovers: the old `AnalysisFn` log group; a duplicate `revoke` export in
  `packages/core/src/index.ts`.

---

## Checked and fine
- Sessions: httpOnly, SameSite=Lax, Secure cookies; JWT checked for issuer,
  audience, RS256 and `token_use`; logout revokes the refresh token.
- tRPC: every data procedure is protected and scoped to the caller; the only
  public ones (`me`, `paddles.shared`) strip private fields and the AI text.
- REST ownership checks on accounts, devices, entries, groups, trials, invitations.
- No `dangerouslySetInnerHTML`/markdown renderer/`eval`; SES sends are structured.
- No secrets in the repo or its history.
- Device tokens are 32 random bytes, stored hashed, compared in constant time;
  device auth is separate from browser auth.
- Server Lambda IAM is otherwise narrow (named SSM parameters, one Cognito pool,
  InvokeModel only). Public access to the data bucket is blocked.
- Trial leaderboards only expose the start-to-finish segment, never the full trace.
