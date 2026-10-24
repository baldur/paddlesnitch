# paddlesnitch for Android

Kotlin + Jetpack Compose + Material 3, Android 10 (API 29) and up. The plan is
[`docs/features/android-app.md`](../../docs/features/android-app.md); what it
shares with the iPhone app is [`mobile/contract/`](../contract/README.md).

## Build and run

Needs Android Studio (for its SDK and bundled JDK). From this directory:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # once
./gradlew :app:testDebugUnitTest    # unit tests
./gradlew :app:installDebug         # build and install on the phone plugged in over USB
```

Or open this directory in Android Studio and press Run. The debug build is
`com.paddlesnitch.app.debug`, so it sits beside the real app.

## Where things come from

- **Colours and radii**: generated at build time from
  `mobile/contract/tokens/tokens.json` into `PsColor` / `PsRadius`
  (`generateTokens` in `app/build.gradle.kts`). Never hard-code a colour.
- **API models**: generated at build time from `mobile/contract/api/` into
  `com.paddlesnitch.app.api` (`buildSrc/src/main/kotlin/ContractModels.kt`).
  An enum or `kind` the app doesn't know decodes to `Unknown`, never an error.
  `FixturesTest` reads every golden answer in `mobile/contract/fixtures/api`.
- **Sample paddles**: the same fixtures ship as assets and are shown, labelled,
  until sign-in.
- **Signing**: debug builds use the local debug key. CI signs release builds
  with the upload key from the `ANDROID_UPLOAD_*` secrets (see
  `.github/workflows/android.yml`); the key is never in the repo.
