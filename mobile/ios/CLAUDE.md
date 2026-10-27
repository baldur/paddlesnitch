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
  (`xcodebuild -downloadPlatform`) is an xcodebuild too.
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
- Test scrolls start in the side margin (`swipe(up:)`), outside every
  row: `app.swipeUp()` starts mid-screen, and at the largest text size it
  landed on a tracker card and opened it.
