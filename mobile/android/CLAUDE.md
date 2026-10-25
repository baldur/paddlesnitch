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
