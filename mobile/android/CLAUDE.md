# mobile/android — lessons

How to build, run and test is in `README.md`; the design is in
`docs/features/android-app.md` and `docs/features/mobile-apps.md`. This file
holds the non-obvious lessons the `android` role learns, so the next session
starts from them (see `docs/agents.md`). Add one whenever something cost real
time and isn't obvious from the code.

## Lessons

- Use your own emulator clone, not the shared AVD: other sessions take it.
- Building from a terminal: there's no system Java, so set
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` and
  `ANDROID_HOME=~/Library/Android/sdk` (adb is in its `platform-tools`).
- The app claims `paddlesnitch.com/paddles/…` links (`Incoming.kt`). Anything
  it sends back to the website must name the browser's package
  (`openInBrowser` in `App.kt`): an unnamed Custom Tab to a claimed URL comes
  straight back to the app. A new page under `apps/web/src/app/paddles/` must go
  in `notPaddles` (`IncomingTest` fails otherwise).
- App links verify only for the release build (`com.paddlesnitch.app`, upload
  key in `assetlinks.json`). Test the debug build with
  `adb shell am start -a android.intent.action.VIEW -d https://paddlesnitch.com/paddles/<id> com.paddlesnitch.app.debug`.
- `adb exec-out screencap` gives a black image when the phone is locked
  (`dumpsys power` shows `mWakefulness=Dozing`).
- M3 colours text and outlined buttons with `primary`, which is the filled-button
  blue (`PsColor.primary` #0369a1, about 3:1 on the dark ground). Every
  `TextButton` and `OutlinedButton` passes `colors = textColors()` or
  `outlinedColors()` (`ui/Buttons.kt`), or its own; `ButtonColoursTest` fails on
  one that doesn't. Tabs pass `selectedContentColor = PsColor.primaryText`. Text
  fields, checkboxes and switches do the same with `fieldColors()`, `checkboxColors()`
  and `switchColors()` (`ui/Fields.kt`). The theme's `primary` stays #0369a1 for
  filled buttons (lead, 2026-10-26).
- TalkBack reads a change inside a live region it already knows, not a node
  that has just appeared. Keep the live-region container in the layout even
  when it's empty (`AddPaddleCard(card = null)`).
- Links, files and the add-paddle card go through `Intake.kt`, which is plain
  Kotlin, so `IntakeTest` covers every path through sign-in. Keep App.kt to
  carrying out its steps.
- `Api` failures the server didn't explain are `ApiFailure(generic = true)`.
  Show them with `it.shown("Couldn't <what failed>. Please try again.")`, never a
  status code.
- Robolectric Compose tests: `performClick` on a node scrolled off screen
  misses (the tap lands outside the window), so `performScrollTo()` first. An
  `AlertDialog` holding a focused text field never goes idle there, which is one
  more reason the delete confirmation is inline, as on the website.
- Account screens take `AccountApi` (Api implements it), so
  `AccountScreensTest` drives them with `FakeAccountApi` and `AccountApiTest`
  checks the real calls against MockWebServer and the contract's fixtures.
- To test anything that opens a system screen (the save dialog), provide a
  fake `ActivityResultRegistry` through `LocalActivityResultRegistryOwner`.
  `FakeSaveDialog` in `AccountScreensTest` records the input and answers with
  a `file://` Uri, which `contentResolver.openOutputStream` writes under
  Robolectric.
- Which screen shows is `screenFor` in App.kt (`ScreenTest`). Terms that need
  accepting come before every signed-in screen, and are checked on every start
  (`api.terms()`), not only at sign-in.
- Deleting the account needs a sign-in from the last 10 minutes. `DeleteAccount`
  asks `accountStatus()` first. A stale sign-in, or a 403 with
  `ApiFailure.reauth`, shows the "Sign in again" notice, never an error. The
  round trip (sign out, sign in again, back to Delete) is `Reauth.kt`, plain
  Kotlin like `Intake` (`ReauthTest`). It resumes only for the same user id,
  and `signedOut()` clears it. The email to fill in stays out of saved state.
- Robolectric doesn't throw when there's no browser. A Custom Tab launch is
  recorded instead: check it with
  `Shadows.shadowOf(activity).nextStartedActivity`.
- Email sign-up proves the address with a code (#702). `signUp` answers
  `CodeSent`, and `confirmSignUp` signs in. A login 403 with `needsCode` opens the
  same "Confirm your email" step. In Compose tests, `compose.mainClock.advanceTimeBy`
  drives a `LaunchedEffect` `delay`, such as the 30-second pause between codes
  (`SignUpCodeScreenTest`).
- Strava connect (`account/StravaConnect.kt`) ends on
  `com.paddlesnitch.app:/account/strava`. `Incoming` must match that before the
  sign-in return, since the manifest's scheme filter catches both. A return with
  no stored connect verifier is ignored (anyone can open the address), and
  `Reauth.After.ConnectStrava` brings a fresh sign-in back to Account.
- Older Strava paddles come in one at a time (`StravaImporter`, plain Kotlin with an
  injectable clock and sleep). `StravaImportModel` is the app's first ViewModel: it
  keeps the import through rotation and setting changes. `onDispose` calls `stop()`
  only when `!activity.isChangingConfigurations`, and keeps the screen on while an
  import runs. TalkBack hears only start, waiting, stopped and done
  (`importAnnouncement`). Use `semantics { contentDescription }`, not
  `clearAndSetSemantics`, so tests can still find the visible text.
- Large-text goldens catch rows that squeeze text to a letter per line. Use
  `FlowRow` for a badge, name and action on one line.
- Forgot password is in the app (`ForgotPasswordScreen`, shown inside signing in).
  A reset that signs in returns a `SignIn` built from `me`, so App.kt's one
  `signedInWith` handles it like any sign-in: reauth, intake and the Terms check
  on start.
- Trackers (`tracker/TrackersScreen.kt`) show the server's `summaries` as they are.
  Recordings, firmware and last-seen are looked up by id from the same answer, never
  added up in the app. Anything with "ago" in a golden takes an injected `now`, or
  the golden fails the next day.
- Type is IBM Plex, bundled (`res/font`, the same files as iOS; the OFL licence is in
  `assets/licences`). The theme sets Plex Sans for every style (`ui/Type.kt`).
  Numbers and mono labels use `PlexMono`, never `FontFamily.Monospace` (`TypeTest`).
- Which sign-ins are on comes from `GET /att/api/auth/options`, asked each time sign-in
  and Account open (`loadOptions`, `AccountApi.signInOptions`). A failure says so with Try
  again on both screens. It never quietly counts as "Strava off". With Strava off, Account
  shows Strava only to a connected account, as Paused. On sign-in, an account made with
  Strava gets "Email us" (mailto), never the issue form: reports are public. Before deleting,
  it gets Report an issue, opened through `signedInPage("/account?report=1")` so the report
  is filed as that account. Screen tests built on MockWebServer must pass their own
  `loadOptions`, or the options call eats an answer meant for the test.
- A `LaunchedEffect` that waits for other state must wait inside one run
  (`snapshotFlow { … }.first { it }`) and read that state after the wait. Adding the state as
  a key reruns the effect, which wipes the first run's result. A value read into a `val`
  before the effect is the one from first composition.
- Sign in with Google (`auth/GoogleSignIn.kt`) is PKCE like Strava. The return address is
  `com.paddlesnitch.app:/signin/google`, and App.kt acts on it only while
  `PrefsGoogleVerifierStore` holds a verifier from the last 10 minutes.
- Boat motion (`paddles/BoatMotionScreen.kt`) is offered only on a tracker paddle
  (`hasBoatMotion`). It draws the server's numbers as they are, and the Stroke rate tile is
  the paddle's own `result.avgSR`. Charts are Compose `Canvas` with text from a
  `TextMeasurer`. Size their margins from the measured label text and their height from
  `fontScale`, never in fixed dp: fixed margins overlapped at large text. Tile labels are
  long mono words, so tiles go one per row at large text, or they break mid-word.
  `Api.recordingMotion` keeps each answer's ETag and reuses the body on a 304.
- A golden that "scrolls to" something already on screen doesn't move. Scroll to a node
  that starts below the fold, or the second golden repeats the first.
- Recording on the phone (`record/`): `PhoneRecorder` hands SensorEvent and Location values to
  the recorder core's phone layer as Android gives them (m/s², rad/s, `event.timestamp`,
  `elapsedRealtimeNanos`), every call on one HandlerThread. Never convert or sort them here:
  `recorder-core/test/one_implementation.sh` fails on the standard-gravity number or 180/π written
  anywhere in mobile/, tests and this file included (use `SensorManager.STANDARD_GRAVITY` for a test's input). Behind
  `BuildConfig.DEBUG` until recordings upload (C3).
- The JNI library is built twice: by the NDK into the APK, and for the host by `hostRecorder`
  (jni.h copied from the NDK: Android Studio's JDK has no headers), so `RecorderFixturesTest`
  replays recorder-core's fixtures through the real binding. Two traps: the Test task must list
  the library as an input or a changed `.c` file leaves the tests "up to date" (a mutation once
  passed that way); and the JVM loads one library file in one classloader only, so with
  Robolectric's sandbox as a second one, each loads its own temp copy.
- Recording's permissions and `RecordingService` live in `src/debug/AndroidManifest.xml` until
  recordings upload. MapLibre's manifest adds fine/coarse location to release builds by itself.
- The recorder thread's own clock in tests: Robolectric's `idleFor` jumps the clock in one go, so
  step a second at a time to see each tick, and give the recorder a clock that moves
  (`SystemClock.uptimeMillis()`), or the core ignores every tick after the first as a repeat.
  Robolectric's `sendSensorEventToListeners` ignores the Handler, so tests send from the
  recorder thread themselves (`onThread`).
- A recording's write errors never reach the core: `RecordingFiles.write` catches and counts
  them, and the JNI callback returns early while an exception is pending (CheckJNI aborts a
  debug build that makes JNI calls with one pending).
- Record sits above every screen (`WithRecording` wraps App's `when (screen)`), never inside a
  signed-in screen: a refused token refresh signs out by itself (#702), and a Record screen
  owned by Paddles would vanish mid-paddle with its Hold to stop while the service kept
  recording (found by ios in #767). Signed out, it's reachable only while a recording runs.
- Recordings are kept per account, as on iOS (#767; lead's rules in #761): `recordings/<user id>/`,
  the id kept with the tokens (`TokenStore.userId`, set at every sign-in; `api.accountId()` asks
  `me` once for an older sign-in). Deleting the account removes its folder (`deleteRecordings`);
  signing out keeps it (the only copy until upload). Recordings stay out of backup, and a second
  recording in the same second is `track_<stamp>_1` (the tracker's rule): both decided by lead,
  2026-10-31, for both apps.
- A recording belongs to whoever started it. `RecordingService` notes that account in its own
  prefs, and a sticky restart reads the note, never the token store (someone else may have
  signed in by then). Deleting an account stops only a recording in that account's folder. An
  account erased on the website leaves its folder on the phone until that account deletes from
  the app (C3 should cover it). Test a sticky restart by calling `onStartCommand(null, …)`:
  `ServiceController.withIntent(null)` still sends an intent.
- The release build declares exactly the permissions in `releasePermissions`
  (`app/build.gradle.kts`), because Play's forms ask about each one. Every release build
  runs `checkReleasePermissions` (and CI runs it on every change). It fails on any
  permission added or gone, and if `src/main` declares location. MapLibre adds fine and
  coarse location, which `src/release/AndroidManifest.xml` removes with
  `tools:node="remove"`. That overlay would also quietly remove the app's own, so phone
  recording (#761) deletes it, and until then declares its permissions only in `src/debug`.
- Play takes the `.aab` (`bundleRelease`), not the APK. The steps to publish on Google Play
  are in `PLAY-RELEASE.md`.
- Release hides Strava (`STRAVA_IN_APP`, a `buildConfigField` per build type). `Api` then
  reads `strava` as false in `signInOptions`, so the app takes its tested "server switched
  Strava off" path everywhere. Don't add a second switch in the screens. Debug keeps
  Strava, so the screen tests still cover it. `checkReleaseStrava` reads the generated
  release `BuildConfig.java`, because unit tests only build debug.
- Every sign-in return address can be opened by any app or link. `Intake.arrived` passes a
  Strava or Google return on only while this app's verifier for it is waiting
  (`PrefsVerifierStore.pending`, `PrefsGoogleVerifierStore.pending`) and nobody is signed in.
