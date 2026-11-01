# Getting the Android app on Google Play

A checklist for phase P5 (Google Play) in `docs/features/android-app.md`. Tick
items off as they land. **Owner** items need the owner's account or decision.
**android** and **lead** items are for those Claude roles.

The slowest part is Google's rule for personal accounts. A **closed test with
at least 12 testers opted in for 14 days in a row** must run before production.
Start that clock early; everything else fits inside the 14 days.

Play Console and Google Cloud menu names below are as of October 2026. Check
each label on screen; Google moves them.

## What ships in the first release

The release build as it is today:

- Paddles: the list, one paddle, Boat motion, add paddle, opening paddle links.
- Sign-in with email or Google, and Account.
- Trackers: the list, removing one, and **tracker setup over Bluetooth**
  (pair, add to the account, WiFi, sync).
- **Phone recording** (C3, #761): Record on Paddles. The phone records GPS
  and motion with the screen off, then uploads the recording, which becomes a
  paddle. The phone is added to the account as a device; phones are listed and
  removed on the website's Devices page, not in the app.

Not in this release:

- **Strava:** hidden in release (`STRAVA_IN_APP` in `app/build.gradle.kts`).
  The app reads Strava as off whatever the server says, as when the server
  switches it off. Sign-in has no Strava button. An account that signed up
  with Strava gets "Email us". An account already connected sees Strava as
  Paused, with Disconnect. Bringing Strava back is an app release, and the
  data safety form changes with it (see Later releases). The APK on
  paddlesnitch.com/android is the same release build, so it hides Strava
  too. `checkReleaseStrava` fails any release build that shows Strava.

Owner decisions (2026-10-31): keep tracker setup and test it first; hide
Strava. 2026-11-01: phone recording is in (C3).

- [ ] **Owner:** run `TRACKER-TESTING.md` with a real tracker on a release
      build, before the closed test starts. If it fails, `android` fixes it or
      hides setup in release; the Trackers list stays either way.
- [ ] **Owner:** record a real paddle with the phone on the C3 PR's build,
      with the screen off for most of it. The PR merges only after that
      (`mobile/contract/README.md` § Release). Check that it becomes a paddle
      with stroke rate and boat motion.

## Day 1: the developer account (owner)

- [ ] **Owner:** create a personal Play Console developer account (US$25 and
      an ID check). Google may take a few days to verify it, and the Play
      steps below wait for that. The same check covers Google's Android
      developer verification, so there's nothing extra to do for it.
- [ ] **Owner:** pick 12 or more closed testers; the tracker beta group is a
      good start. Collect the Google account email each uses on their phone.
      Keep the list out of the repo and out of CI.

## Once the account is verified: the app and the first upload

- [x] **android:** CI builds an app bundle (`.aab`, `bundleRelease`) as well
      as the APK, because Play takes only bundles. It's signed with the upload
      key and saved as the CI artifact `paddlesnitch-release-bundle` (#782).
- [x] **android:** `versionCode` is the workflow's run number, so it goes up
      with every build. Don't rename or move `.github/workflows/android.yml`:
      a new file starts the count again, and Play refuses a lower number.
- [x] **android:** the release build declares exactly the permissions listed
      in `releasePermissions` (`app/build.gradle.kts`). Every release build
      checks it. Location, the location foreground service and notifications
      are for phone recording (C3); the boot permission is WorkManager's, so a
      waiting upload survives a restart. No background location.
- [ ] **Owner:** in Play Console, **Create app**: name paddlesnitch, app, free.
      The package name `com.paddlesnitch.app` is set by the first upload.
- [ ] **Owner:** once #782 is merged, make the first upload by hand; Play
      needs one before CI can publish. From the latest **Android** run on
      `main`, download the artifact `paddlesnitch-release-bundle`. In Play
      Console, open **Test and release → Testing → Internal testing → Create
      new release** and upload the `.aab`. When Play asks about the app signing
      key, keep Google's key (Play app signing). Our upload key stays the
      upload key.
- [ ] **Owner:** open **Test and release → App integrity → Play app signing →
      Settings**. Copy the **SHA-256 certificate fingerprint** under **App
      signing key certificate** and send it to `lead`. Lead adds it to
      `/.well-known/assetlinks.json` beside the upload key's. Without it,
      paddle links from a Play install open the browser, not the app.

## Publishing from CI (owner first, then lead)

No key file is stored. For each run, GitHub proves to Google which repository,
workflow and branch it is, as it already does for AWS. Only one job can
publish: the upload job in `android.yml`, on `main`, in a GitHub environment
called `play`. Other workflows in the repo (the Claude issue loops, firmware
releases) also get GitHub sign-in tokens, so Google must refuse theirs.

- [ ] **Owner:** in GitHub → the repository's **Settings → Environments**,
      create `play`. Under **Deployment branches**, allow `main` only.
- [ ] **Owner:** in the Google Cloud console, create a project (for example
      `paddlesnitch-play`). Enable the **Google Play Android Developer API**.
- [ ] **Owner:** **IAM & Admin → Service accounts**: create one (for example
      `play-publisher`). Give it no project roles; Play grants its access.
- [ ] **Owner:** **IAM & Admin → Workload Identity Federation**: create a pool
      named `github`, with an OIDC provider also named `github`:
  - Issuer: `https://token.actions.githubusercontent.com`.
  - Attribute mapping: `google.subject = assertion.sub`,
    `attribute.repository_id = assertion.repository_id`,
    `attribute.environment = assertion.environment`.
  - Attribute condition, all on one line:
    `assertion.repository_id == '1254392477' && assertion.repository_owner_id == '759' && assertion.environment == 'play' && assertion.ref == 'refs/heads/main' && assertion.job_workflow_ref.startsWith('baldur/paddlesnitch/.github/workflows/android.yml@refs/heads/main')`.
    The numbers are the repository's and the owner's GitHub ids, which never
    change, as in the AWS setup (`infra/lib/att-stack.ts`).
- [ ] **Owner:** on the service account → **Permissions → Grant access**, give
      **Workload Identity User** to this one subject, not to the whole
      repository:
      `principal://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/github/subject/repo:baldur@759/paddlesnitch@1254392477:environment:play`.
      `<number>` is the project number (digits, on the project's dashboard),
      not the project ID.
- [ ] **Owner:** in Play Console → **Users and permissions → Invite new
      users**, paste the service account's email. On **App permissions**, add
      paddlesnitch only and tick **Release apps to testing tracks**. Leave
      everything else off: production, managing testers, the store listing,
      financial and admin.
- [ ] **Owner:** send `lead` the project number, the provider's resource name
      (`projects/<number>/locations/global/workloadIdentityPools/github/providers/github`)
      and the service account's email. None of these is a secret.
- [ ] **lead:** an upload job in `android.yml` with `environment: play`, on
      merges to `main` that touch the app. It is the only job that asks Google
      for a token, and it uploads the bundle to **internal testing**.
      Promoting a build to the closed test stays a step in Play Console, by
      hand.

## Forms and listing (owner, with help)

All of these must be done before the closed test can start.

- [ ] **lead:** `/privacy` covers the apps and matches the data safety
      answers below.
- [ ] **Owner:** data safety form, with the answers below.
- [ ] **Owner:** account deletion: in the app (Account → Delete account) and
      on the web at `https://paddlesnitch.com/account`.
- [ ] **Owner:** **App content → Foreground service permissions**: declare
      the `location` type for phone recording. Play asks for a short video:
      start a recording, lock the phone, show the notification with Stop,
      unlock, and stop with Hold to stop. Describe it as "Records the paddler's
      route and boat motion with the screen off, until they stop it."
- [ ] **Owner:** if Play asks about location permissions, the answer is
      "while the app is in use" only: recording runs as a foreground service
      the paddler starts, so there's no background location declaration.
- [ ] **Owner:** content rating questionnaire; target audience 18 and over
      (not children); app category Sports.
- [ ] **Owner + android:** store listing: name, short description (at most
      80 characters), full description, a 512×512 icon, a 1024×500 feature
      graphic, and at least 2 phone screenshots from a release build on the
      owner's phone. `copy-style` reviews the words.

### Data safety answers (checked with lead, 2026-10-31)

- **Does the app collect or share any of the required user data types?** Yes.
- **Is all of the data encrypted in transit?** Yes (HTTPS only).
- **Can people ask for their data to be deleted?** Yes: Account → Delete
  account in the app, and the same on the website.
- **Shared with third parties?** No. Play doesn't count sending data to
  service providers (hosting, the paddle summary) as sharing. `/privacy` names
  them.
- **Map tiles:** the app loads map tiles straight from Esri's tile server,
  which sees the phone's address and the area of the map. **Open with lead:**
  `/privacy` names Esri for the browser only, and whether this counts as
  sharing is undecided. Settle it before the form.
- **Collected:** all for App functionality and Account management. None is for
  advertising, and none is sold.

  | Play's data type | What it is here | Required or optional |
  |---|---|---|
  | Personal info → Name | account name; from Google when you sign in with it | Required |
  | Personal info → Email address | sign-in email, contact email | Optional (an account made with Strava on the website may have none) |
  | Personal info → User IDs | account id, public handle, Google account id | Required |
  | Location → Precise location | the GPS tracks in paddles you add, record with a tracker, or record on the phone | Optional (only when you add or record a paddle) |
  | Health and fitness → Fitness info | distance, pace, stroke rate and boat motion of those paddles, including the phone's own motion while it records | Optional (only when you add or record a paddle) |
  | Files and docs | the GPS files you add, processed ephemerally (the server keeps the paddle, not the file) | Optional |
  | Device or other IDs | the id of each tracker you add to your account; for a phone that records, an id made from a random number the app keeps (never a hardware or advertising id) | Optional (only with a tracker, or once you record on the phone) |
  | App info and performance → Other diagnostic data | the app's version, sent with each request and kept in server logs for 90 days | Required |

- **The phone's location** is collected only while a recording runs, which the
  paddler starts and stops. It's kept on the phone until uploaded, then deleted
  from the phone.
- **Not collected:** contacts, photos, messages, crash logs, analytics. Heart rate isn't stored even when a FIT or TCX file
  has it, and `/privacy` says so.
- **WiFi name and password** for a tracker go from the phone to the tracker
  over Bluetooth, never to our server. Nothing to declare.
- **Strava** is hidden in this release, so the app brings nothing in from
  it. Paddles brought in from Strava on the website show in the app like any
  other paddle, and the rows above cover them.

## Closed test starts (owner)

- [ ] **Owner + android:** check the release on the owner's phone from the
      internal track. Install from Play, sign in, open a paddle and add a
      paddle. Record a short paddle on the phone and check it becomes a paddle. Sign-in and Account show no way to connect Strava. Then open a
      `paddlesnitch.com/paddles/<id>` link. It should open the app (this needs
      the fingerprint from the Play app signing step).
- [ ] **Owner:** in Play Console, create the closed testing track, add the
      testers and send them the opt-in link. The 14 days count from when 12
      are opted in.

## 14 days later: production (owner)

- [ ] **Owner:** apply for production access in Play Console (it asks about
      the closed test), then promote the build.

## Later releases

- **Telemetry from the app** (observability O3: `app_open`, `crash_report`):
  whoever adds it updates the data safety form in the same release. Declare
  **App info and performance → Crash logs** and **App activity → App
  interactions**: collected, not shared, required, for Analytics and App
  functionality. Today they are "not collected" only because the Android app
  sends neither yet.
- **Strava back in the app:** set `STRAVA_IN_APP` to true for release, and
  change `checkReleaseStrava` (`app/build.gradle.kts`) with it.
  - Location and Fitness info gain "imported from Strava" as a source; Name
    can come from Strava.
  - Strava is read-only: the server reads the user's Strava paddles and sends
    Strava nothing back, so there's still nothing to declare as shared.
  - The store listing can mention Strava only once the server has it on.
- **Automatic tracker sync** (a `connectedDevice` foreground service): its own
  declaration and video.
