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
  text, descenders too. A text field scrolls its text rather than cutting it,
  so `AppTestCase.audit` ignores that one report on text fields only
  (`isTextFieldClipWarning`); clipping anywhere else still fails.
- The audit's clip report on no element also comes from a row half under the
  navigation or tab bar. `AppTestCase.audit` looks up to three times, moving
  the page a little before each, and fails only if every look reports it: a
  real clip is layout and stays. On a long List the largest-text check goes
  section by section (`checkScreen(at:)`), as each check resizes the text and
  the List jumps back up.
