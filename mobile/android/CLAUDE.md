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
- `TextButton` takes its text colour from M3 `primary`, which is `PsColor.primary`
  (#0369a1, ~3:1 on the dark ground). Give text buttons
  `ButtonDefaults.textButtonColors(contentColor = PsColor.primaryText)`.
  Older screens still use the dark one.
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
