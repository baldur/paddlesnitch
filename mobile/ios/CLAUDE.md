# mobile/ios — lessons

How to build, run and test is in `README.md`; the design is in
`docs/features/ios-app.md` and `docs/features/mobile-apps.md`. This file holds
the non-obvious lessons the `ios` role learns, so the next session starts from
them (see `docs/agents.md`). Add one whenever something cost real time and
isn't obvious from the code.

## Lessons

- Generated Swift (`make generate`, from `mobile/contract/`) is never
  hand-edited or hand-merged; regenerate it on the branch instead.
- Never put text in a fixed-size box (`.frame(width:height:)`): at the largest
  text sizes it truncates ("NO GPS" became "N…"). Use
  `.frame(minWidth:minHeight:)` so the box grows with the words.
- `performAccessibilityAudit` is not deterministic. Its clipped-text check
  enlarges the text in place, the screen re-lays out (a scrolled page jumps),
  and it can then report an issue it can't pin to any element. When CI fails on
  an unpinned audit issue, download the `ios-test-results-*` artifact and
  export its attachments (`xcrun xcresulttool export attachments`): the
  screenshot and screen recording show what it saw. A real clip shows in the
  screenshot. A page that jumped is the audit's own doing.
- A `List` row taller than the screen (a long paragraph at the largest text
  size) can leave the whole List blank after scrolling past it. Keep list rows
  short; put long text in an alert message or its own scrolling screen.
  `LargeTextTests.checkWholeScreen(last:)` scrolls until a screen's last row is
  readable, so a blank list fails.
- Don't gate an alert's button on its `TextField`: on iOS 17 the button's
  `.disabled` doesn't follow the field, and tapping it does nothing (seen on
  CI, fine on iOS 27). Use a sheet you control (DeleteAccountView). An
  alert's `TextField` also keeps no accessibility identifier. Since iOS 26 a
  `confirmationDialog` is a popover with no Cancel button.
- Run the UI tests on iOS 17 too when a screen is new: CI does, and the two
  differ (alerts, dialogs, tab bars). There's no iOS 17 simulator on this Mac.
- The audit's clipped-text check flags a text field with text in it (our
  Plex font) as clipped when nothing is: zoomed screenshots show the whole
  text, descenders too. `AppTestCase.audit` ignores that one report on text
  fields (`isTextFieldClipWarning`); check clipping in `LargeTextTests` with
  the fields empty.
- iOS shows "Use Strong Password?" on a new-password field and "Save
  Password?" after it's sent, at different moments on each iOS (26.5 and 27
  differ), covering buttons and swallowing keys. With `-SampleServer` the
  password fields have no autofill type (`PaddlesnitchApp.password`), which
  stops "Use Strong Password?"; iOS 26 still asks "Save Password?" for any
  secure field, so tests that send a new password call
  `declineSavingPassword()`. CI's "newest iOS" isn't this Mac's: check
  `scripts/simulator.sh` on both, and install CI's runtime to reproduce
  (`xcodebuild -downloadPlatform iOS -buildVersion 26.5`).
- To queue UI runs, wait on the xcodebuild binary itself
  (`pgrep -f "^/Applications/Xcode.app/.*/xcodebuild test"`): a pattern like
  `pgrep -f "xcodebuild test"` also matches the waiting shells' own command
  lines, and two of them wait on each other forever. A download
  (`xcodebuild -downloadPlatform`) is an xcodebuild too. Never wait on another
  queued job by a name in its command (a log file, a script name): its own
  line holds that name, and two such waits deadlocked three runs for hours.
  Queue several runs as one script that runs them in turn.
- The audit's clip report on no element also comes from a row half under the
  navigation or tab bar. `AppTestCase.audit` looks up to three times, moving
  the page a little before each, and fails only if every look reports it: a
  real clip is layout and stays. On a long List the largest-text check goes
  section by section (`checkScreen(at:)`), as each check resizes the text and
  the List jumps back up.
- A test helper must never tap by accident: a short press-and-drag counts as
  a tap on whatever it starts on (it flipped "Make profile private" between
  audit looks). Scroll with a clear drag from a margin, and check the
  screenshots for state that changed between steps.
- On a long List at the largest text size, rows sit half under a bar
  wherever the page stops, and the audit reports "may be clipped" on no
  element at every position with nothing clipped in the screenshots. There
  (`LargeTextTests.checkScreen`) only reports pinned to an element fail; the
  screenshots are kept. Everywhere else (`checkWholeScreen`, the screens'
  audits) element-less reports still fail: the real "N…" clip came as one.
- Open a sheet from a sheet's result only once the first has finished
  closing (`onDismiss`, kept as `AccountModel.signInSheetUp`), never after a
  fixed delay: iOS 17 on CI took longer than 700 ms, and a sheet asked to
  open while another closes is dropped without a word. Not through the
  environment: iOS 17 doesn't pass its changes to pushed screens.
- A sheet closed while it's still opening (a sign-in that finishes at once
  against the sample server) gets no `onDismiss` on iOS 17. Let a sheet be
  fully up before it acts by itself, and don't let a flag that only
  `onDismiss` clears be the only way on.
- Push screens by value, with the destination declared on a screen that
  stays in the stack (`navigationDestination(for:)`). On iOS 17 a
  `NavigationLink { destination }` two screens under a typed path hung
  opening a paddle (CI: "App event loop idle notification not received").
  You's path is a `NavigationPath`, so a pushed screen can add its own routes.
- iOS 17's audit cuts long text in List rows and section footers where newer
  iOS doesn't: give every sentence `.fixedSize(horizontal: false, vertical: true)`.
- Test scrolls start in the right margin (`swipe(up:)`), outside every
  row: `app.swipeUp()` starts mid-screen, and at the largest text size it
  landed on a tracker card and opened it. Not the left margin: the back
  gesture has it, and in the sign-in sheet a drag there scrolled nothing.
- UI test time: XCTest's waits (`waitForExistence`, `waitForNonExistence`,
  `XCTNSPredicateExpectation`) first look a full second after they start, even
  when the element is already there. With ~15 per test that was a third of
  every test, and the newest-iOS job crept past its 70-minute limit. Use
  `appears(timeout:)`, `disappears(timeout:)` and `poll(timeout:)`
  (`Tests/UI/Waiting.swift`); SwiftLint's `xctest_waits` rule enforces it.
  Also check `exists` before `isHittable`: on a missing element it spends ~2 s
  looking. To find where a test's time goes, run it with `-resultBundlePath`
  and read the gaps between steps in
  `xcrun xcresulttool get test-results activities --test-id …`.
- `scrollToElement` drags by the distance it measures, then holds. A fixed
  fast swipe flung the page past a target at the largest text size, and back,
  for all ten tries. It stops when a drag leaves the target where it was (the
  page goes no further). Without that, one large-text test made 111 drags and
  seven times main's looks.
- Every look a UI test takes (`exists`, `frame`, a tap) makes XCTest log
  inside the app. Once the tests got faster, the system quarantined the app's
  logging for volume (`QUARANTINED DUE TO HIGH LOGGING VOLUME`), and on iOS 17
  that crashes XCTest's own code in the app. The test sees "not running" or
  "Lost connection", and the crash report shows
  `runtime_issue_os_log_fault_callback` → `strcmp`. So `AppTestCase` launches
  the app with `OS_ACTIVITY_MODE=disable`, and `poll` backs off to one look a
  second. To measure log volume, count the app's lines with
  `xcrun simctl spawn <udid> log stream --predicate 'process == "Paddlesnitch"'`,
  or search `log show` for `QUARANTINED`.
- CI's log has no test lines until the run ends, because xcbeautify holds
  them back. A cancelled job's only clue is the `IDELaunchParametersSnapshot`
  lines, one per app launch. `make test-app` therefore gives each test 6
  minutes (`-default-test-execution-time-allowance`), and CI keeps the results
  when a job is cancelled too.
- A UI test that answers a permission prompt leaves the answer for every
  later test on that simulator: "Don't Allow" in one test hid the record
  screen's Start button in the next. A test that needs the prompt calls
  `app.resetAuthorizationStatus(for:)` first (it ends the app; launch again),
  and helpers wait for the screen, not for a button a permission can hide.
- Recording in the simulator: no accelerometer or gyroscope (track only), and
  a fixed `simctl location` gives one fix and then nothing, so rows read "no
  fix" 3 s later, as the tracker's do. That's the recorder core's rule, not a
  bug. The sensors are proved by `RecorderTests` and a bench check on a phone.
- Never compute a recording number in the app: the shared recorder core does
  it (`recorder-core/test/one_implementation.sh` fails CI on unit
  conversions (standard gravity, radians to degrees) anywhere in `mobile/`,
  even quoted in a comment like this one). Pass Core
  Motion's g, rad/s and `timestamp` untouched; the core negates and converts.
- Recordings are kept per account (`AccountModel.recordings(for:)`,
  Documents/Recordings/<user id>), so an upload can only ever send the
  signed-in account's own. Deleting the account removes that folder; signing
  out keeps it (the only copy until upload). The folder is left out of
  backups (lead, #761, as Android): a track shows where someone paddles, and
  losing an un-uploaded one with the phone is the accepted cost until C3.
  Same second twice: `track_<stamp>_1`, the tracker's rule. Files are `completeUnlessOpen`: encrypted while
  locked, but a file already open stays writable. `.complete` would stop a
  screen-off recording seconds after the lock. A killed recording's file
  can't be reopened until the next unlock.
- A screen that must outlive a sign-out (the record screen) is presented
  from a view that stays through it (Paddles), never from a signed-in-only
  toolbar button: the app signs out on its own when a refresh is refused,
  the button goes, and its full-screen cover goes with it. Here that took
  Stop away mid-paddle. `RecordTests` signs out mid-recording
  (`-SignOutWhileRecording`).
- On iOS 26 a tab tapped while the screens are still redrawing (just after
  signing out) slides towards the new tab and snaps back. Seen once on CI
  (main's run 41112890501: the recording shows the slide and the snap; never
  reproduced locally). Switch tabs with `selectTab(_:)` (Waiting.swift), which
  taps again until the tab is selected, never `tab(...).tap()`.
- CI builds with Xcode 26.6, an older Swift than a newer local Xcode, and
  it is stricter about Sendable: passing a method of a non-Sendable test
  fake as a `@MainActor` closure compiled here but failed on CI ("converting
  non-Sendable function value … may introduce data races"). Make such fakes
  `@MainActor final class`.
- A tap on a sheet that's still sliding up lands where the control was, not
  where it is: "Create account" tapped just as the sign-in sheet opened left
  it on Sign in (iOS 17, CI). Turn the sheet with `showCreateAccount()`
  (Waiting.swift), which taps again until the form is there.
  The same goes for iOS's own alerts: a location answer tapped while the
  alert grows in misses, so use `answerLocation(_:)` (RecordTests.swift),
  which taps until the alert has gone.
- Phone uploads (C3): a queue per signed-in account (RootView). Its
  client's token is that account's only (nil once another signs in), and a
  stopped queue writes nothing: otherwise an old queue's in-flight pieces
  go out with the next account's token and a 404 marks the old account's
  phone "removed". Never upload a track still being written: the queue
  skips `RecordingFiles.isOpen` tracks, not only while its `recording`
  flag is set (a queue made mid-recording hasn't heard yet).
- UI tests and the simulator keep the app's files between tests: a
  refused recording from one test showed in the next. Sample-server
  launches use their own recordings folder (`SampleRecordings`), emptied at
  launch; the real Documents/Recordings is never touched.
- `disappears(timeout:)` is true for an element that never appeared: to
  prove an upload, wait for its result (the sample server lists a
  `pdl-phone` paddle once the track went up), not for the line to go.
- An audit of the Paddles list with lines above the logbook reports "All
  paddles" clipped (the header half under the tab bar): those audits skip
  `.textClipped`; LargeTextTests checks clipping on the whole screen.
- A hand-run `xcodebuild test` takes `-derivedDataPath .build/DerivedData`
  (the Makefile's `DERIVED`, gitignored), never `build/DerivedData`: that one
  isn't ignored, `git add -A` takes thousands of files, and GitHub refuses
  the push. Stage paths by name.
- Read a frame of something that comes and goes (the keyboard) with
  `frameIfThere`, never `exists` then `.frame`: it can go in between and
  XCTest fails the test ("No matches found … Keyboard", #833). AddPaddle's
  "Failed to terminate com.paddlesnitch.app" is the simulator: leave it
  unless it repeats, then reset the simulator before the CI run, never a
  retry (lead).
