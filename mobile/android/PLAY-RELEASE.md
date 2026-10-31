# Getting the Android app on Google Play

A checklist for P5 in `docs/features/android-app.md`. Tick items off as they
land. **Owner** items need the owner's account or decision; **android** and
**lead** items are builds.

The long pole is Google's rule for personal accounts: a **closed test with at
least 12 testers opted in for 14 days in a row** before production. Start that
clock as early as possible; everything else fits inside the 14 days.

## What ships in the first release

The app as it is in release today: Paddles (list, one paddle, add paddle,
links), sign-in, Account. **Not** phone recording (debug only until C3, #761)
and **not** tracker setup over Bluetooth (awaits its hardware test).

## Day 1: accounts (owner)

- [ ] **Owner:** create a personal Play Console developer account (US$25, ID
      check; Google may take a few days to verify). This also covers Android
      developer verification.
- [ ] **Owner:** in Play Console, create the app with package name
      `com.paddlesnitch.app`, and opt in to Play App Signing (Play keeps the
      app key; our existing upload key stays the upload key).
- [ ] **Owner:** pick the 12+ closed testers (the tracker beta group?) and
      collect the Google account email each uses on their phone. Keep the list
      out of the repo.

## Days 1–2: builds Play accepts (android, lead)

- [x] **android:** CI builds an **app bundle** (`bundleRelease`, `.aab`) as
      well as the APK; Play takes only bundles. Signed with the upload key; the
      CI artifact `paddlesnitch-release-bundle` (#782).
- [ ] **android:** `versionCode` must go up with every upload. It is the
      workflow's run number today, which only grows; keep it, and note it
      resets if the workflow is renamed.
- [x] **android:** release declares no location permission. The map library's
      fine and coarse location are removed in `src/release/AndroidManifest.xml`,
      and `checkReleasePermissions` (run in CI) fails if any come back (#782,
      lead's decision). Phone recording declares its own when it ships (#761).
- [ ] **Owner:** first upload by hand (Play needs one before the API can
      publish): from the latest `Android` run on `main`, download the artifact
      `paddlesnitch-release-bundle` and upload the `.aab` to **Internal
      testing** → Create release.
- [ ] **Owner:** in Play Console → Setup → **App signing**, copy the **app
      signing key certificate SHA-256** and send it to `lead`, who adds it to
      `/.well-known/assetlinks.json` beside the upload key's. Without it, paddle
      links from a Play install open the browser, not the app.

### Publishing from CI (owner first, then lead)

Keyless, like AWS: GitHub's OIDC token is swapped for a short-lived Google one,
so no JSON key is stored anywhere. The owner creates the Google side; `lead`
does the GitHub side once these exist.

- [ ] **Owner:** in the Google Cloud console, create a project (for example
      `paddlesnitch-play`) and enable the **Google Play Android Developer API**.
- [ ] **Owner:** IAM → **Service accounts** → create one (for example
      `play-publisher`). Give it no project roles; Play grants its access.
- [ ] **Owner:** IAM → **Workload Identity Federation** → create a pool
      (`github`) with an OIDC provider: issuer
      `https://token.actions.githubusercontent.com`, attribute mapping
      `google.subject = assertion.sub`, `attribute.repository =
      assertion.repository`, and the condition
      `assertion.repository == 'baldur/paddlesnitch'`.
- [ ] **Owner:** on the service account → **Permissions**, grant **Workload
      Identity User** to the principal set for the repository
      (`principalSet://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/github/attribute.repository/baldur/paddlesnitch`).
- [ ] **Owner:** in Play Console → **Users and permissions** → Invite new
      user, add the service account's email, give it this app only, with
      **Release to testing tracks** (not production).
- [ ] **Owner:** send `lead` the project number, the provider's full name and
      the service account's email (none of these is a secret).
- [ ] **lead:** a job in `android.yml` on merges to `main` that touch the
      app: upload the bundle to **internal testing**; a hand-run workflow
      promotes a build to the closed test (like firmware beta → stable).

## Days 2–3: forms and listing (owner, with help)

All are needed before the closed test can start.

- [ ] **lead:** `/privacy` covers the apps (what the app stores on the phone,
      sign-in, that it never asks for location in this release).
- [ ] **Owner:** data safety form, with the answers below (`lead` makes
      `/privacy` match them).
- [ ] **Owner:** account deletion: in-app (Account → Delete account) plus the
      web URL for deleting the account.
- [ ] **Owner:** content rating questionnaire; target audience (not
      children); app category (Sports / Health & Fitness).
- [ ] **Owner + android:** store listing: name, short description (≤ 80
      characters), full description, 512×512 icon, 1024×500 feature graphic,
      at least 2 phone screenshots (taken from a release build on the owner's
      phone). Words reviewed by `copy-style`.

### Data safety answers (draft, to check with lead)

- **Does the app collect or share any of the required user data types?** Yes.
- **Is all of the data encrypted in transit?** Yes (HTTPS only).
- **Can people ask for their data to be deleted?** Yes: Account → Delete
  account in the app, and the same on the website.
- **Shared with third parties?** No. Sending paddle data to the services that
  do work for us (hosting, the coach summary) is not "sharing" in Play's terms,
  and `/privacy` names them.
- **Collected**, all for App functionality and Account management, none for
  advertising, none sold:

  | Play's data type | What it is here | Required? |
  |---|---|---|
  | Personal info → Name | account name | Yes |
  | Personal info → Email address | sign-in email, contact email | Yes |
  | Personal info → User IDs | account id, public handle | Yes |
  | Location → Precise location | the GPS tracks in paddles you add (the app never reads the phone's own location in this release) | No: only if you add a paddle |
  | Health and fitness → Fitness info | distance, pace, stroke rate of your paddles | No: only if you add a paddle |
  | Files and docs | the GPS files you add | No |

- **Not collected:** contacts, photos, messages, the phone's own location,
  device ids, crash logs, analytics, and heart rate (never stored, even when a
  FIT or TCX file has it; `/privacy` says so).
- **Strava** is read only: the server swaps and refreshes its sign-in and
  disconnects it, and sends Strava nothing of the user's. Nothing to declare as
  shared. (Strava is switched off for now.)
- Checked with `lead` against `/privacy` (2026-10-31).

## Day 3: closed test starts (owner)

- [ ] **android:** release check on the owner's phone from the internal track:
      install from Play, sign in, open a paddle, add a paddle, open a
      `paddlesnitch.com/paddles/<id>` link (App Links work only with Play's
      signing key fingerprint in `assetlinks.json`: **lead** adds it).
- [ ] **Owner:** create the closed testing track, add the testers, send them
      the opt-in link. The 14 days count from when 12 are opted in.

## Day 17 or later: production (owner)

- [ ] **Owner:** apply for production access in Play Console (it asks about the
      closed test), then promote the build.

## Later releases

- **Telemetry from the app** (observability O3: `app_open`, `crash_report`):
  whoever adds it updates the data safety form in the same release. Declare
  **App info and performance → Crash logs** and **App activity → App
  interactions**: collected, not linked to identity, kept indefinitely. They are
  "not collected" today only because the Android app sends neither yet.

- Phone recording (after C3, #761, and the 2 h screen-off spike): a
  foreground service of type `location` needs a Play declaration with a short
  video, and the data safety form changes.
- Tracker setup (`connectedDevice` foreground service): its own declaration
  and video.
