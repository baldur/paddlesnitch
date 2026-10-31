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

- [ ] **android:** CI builds an **app bundle** (`bundleRelease`, `.aab`) as
      well as the APK; Play takes only bundles. Signed with the upload key.
- [ ] **android:** `versionCode` must go up with every upload. It is the
      workflow's run number today, which only grows; keep it, and note it
      resets if the workflow is renamed.
- [ ] **android:** release manifest permissions. Release declares
      `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` (pulled in by the map
      library) but never asks for them. Either remove them from release
      (`tools:node="remove"`) or declare them in the forms. **Decision: owner /
      lead** (deferred to #761 so far). Removing is simpler for the first
      release.
- [ ] **lead:** publish from CI to Play's **internal testing** track on each
      merge that touches the app, with promotion by hand (like firmware beta →
      stable). Needs a Google Cloud project on the owner's account, a service
      account with access in Play Console, and keyless GitHub OIDC → Workload
      Identity Federation, matching AWS.
- [ ] **Owner:** first upload by hand (Play needs one before the API can
      publish): download the `.aab` from CI, upload to internal testing.

## Days 2–3: forms and listing (owner, with help)

All are needed before the closed test can start.

- [ ] **lead:** `/privacy` covers the apps (what the app stores on the phone,
      sign-in, that it never asks for location in this release).
- [ ] **Owner:** data safety form: account email and name, and the paddles
      you add (GPS tracks count as precise location, even though the app never
      reads the phone's own location in this release); nothing sold; Strava
      only when you connect it.
- [ ] **Owner:** account deletion: in-app (Account → Delete account) plus the
      web URL for deleting the account.
- [ ] **Owner:** content rating questionnaire; target audience (not
      children); app category (Sports / Health & Fitness).
- [ ] **Owner + android:** store listing: name, short description (≤ 80
      characters), full description, 512×512 icon, 1024×500 feature graphic,
      at least 2 phone screenshots (taken from a release build on the owner's
      phone). Words reviewed by `copy-style`.

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

- Phone recording (after C3, #761, and the 2 h screen-off spike): a
  foreground service of type `location` needs a Play declaration with a short
  video, and the data safety form changes.
- Tracker setup (`connectedDevice` foreground service): its own declaration
  and video.
