# mobile/ios — the iPhone app

Swift + SwiftUI, iOS 17 and up. Spec: [`docs/features/ios-app.md`](../../docs/features/ios-app.md).
Shared with Android: [`mobile/contract/`](../contract/README.md). Not a pnpm
package; `pnpm test` doesn't touch it.

## One-time setup

1. Xcode from the App Store, then `sudo xcodebuild -license accept` and
   `sudo xcodebuild -runFirstLaunch`.
2. Simulators: `xcodebuild -downloadPlatform iOS`. `scripts/simulator.sh`
   picks a standard iPhone on the newest runtime that has one (a runtime can
   be built for one new model only: iOS 27.1 24A94425 runs just the foldable).
   Xcode 27 can't download iOS 17 simulators, so the iOS 17 floor is tested in
   CI, where the runner's Xcode 26 still can.
3. Tools: `brew install xcodegen swiftlint xcbeautify`.

No Apple Developer account is needed until P5 (TestFlight); the simulator runs
everything.

## Day to day

```
make run              build and launch the app in the simulator, against
                      paddlesnitch.com (sign in with your own account);
                      SAMPLE=1 for the offline sample server
make open             generate the Xcode project and open it (▶ runs the app)
make test             package tests, then app tests on the newest simulator
make test-app IOS=17  app tests on iOS 17 (needs Xcode 26; CI runs it)
make test-app SHARD=1 half the app tests (SHARD=2 the rest); CI runs the two
                      halves as parallel jobs for each iOS version
make lint             swift-format + SwiftLint, both strict
make format           fix formatting
make generate         regenerate Swift from mobile/contract/
```

CI (`.github/workflows/ios.yml`) runs the same targets on every PR that
touches `mobile/ios/` or `mobile/contract/`.

## Layout

| Path | What |
|---|---|
| `project.yml` | The Xcode project, as text. `Paddlesnitch.xcodeproj` is generated from it and not committed. |
| `App/` | The app target: screens and wiring only. |
| `Packages/PaddleKit/` | Everything testable without a simulator, one target per area (`DesignSystem`, `PaddleAPI`, `Paddles`, `Account`, `SampleServer` now; `Recorder`, `TrackerLink`, `UploadQueue`, `Capabilities` as their phases arrive). `swift test` runs it on the Mac. |
| `Packages/PaddleKit/Sources/PaddleAPI/` | Generated models (`Generated/`), the hand-mapped `Seat` and `Coordinate`, and `PaddleClient`: `try await client.call(Procedures.paddlesGet, ById(id: id))`. |
| `Packages/PaddleKit/Sources/ContractGen*` | `contract-gen`: `mobile/contract/` → Swift. |
| `Packages/PaddleKit/Sources/Paddles/` | The Paddles screens' logic: the web's formatting ported (`Format`, incl. JS `toFixed` rounding), the route colour scale, the list and one-paddle models. Screens in `App/` only draw these. |
| `Tests/UI/` | XCUITest on the bundled sample paddles: the flows, Apple's accessibility audit on every screen, and `LargeTextTests` at the largest text size. |
| `scripts/simulator.sh` | Finds or creates an iPhone simulator for an iOS version. |

## Signing in

Email and password, plus Create account, as on Android and the website
(`Account`):
- The refresh token is kept in the Keychain (this device only); the ID token
  is held in memory and refreshed a minute before it expires. Several calls at
  once share one refresh.
- A call the server turns down with 401 gets a fresh token and is tried once
  more. A refresh token the server refuses signs out.
- The name and email are kept so the next launch shows you signed in without
  the network.

Signed out, Paddles shows the contract's sample paddles
(`mobile/contract/fixtures/api/`, bundled straight from the contract).

## Servers

| How | Server |
|---|---|
| Normal | `https://paddlesnitch.com` (`PaddlesnitchBaseURL` in project.yml) |
| Debug build + `PADDLESNITCH_BASE_URL=http://localhost:3000` in the scheme's environment | your Mac's `pnpm dev` |
| Launch argument `-SampleServer` | `SampleServer`: the contract's fixtures played back offline (password `Password123`; `sam@example.com` must accept new Terms). The UI tests use it. |

`-ResetAccount` starts signed out. The simulator build is signed ad hoc (no
Apple account needed): an unsigned build has no Keychain, so signing in
couldn't stick.

## Accessibility audit notes

- The audit's own Dynamic Type check flags whatever its text growth pushes off
  the bottom of the screen, a different element each run. It's replaced by
  `LargeTextTests`, which launches at the largest size and checks every screen
  for clipped text.
- iOS 26+ draws the tab bar as glass over the content, and the rows under it
  are blurred on purpose. List contrast is audited with nothing under the bar.

## Generated files

`DesignSystem/Generated/Tokens.swift` and the `LaunchBackground` colour come
from `mobile/contract/tokens/tokens.json`; `PaddleAPI/Generated/` comes from
`mobile/contract/api/`. Don't edit them: run `make generate`. A package test
fails while they're out of date.

The generated models follow the contract's rules: unknown fields are ignored,
an unknown enum value or union `kind` decodes to `.unknown(…)` instead of
throwing, `kind` unions are Swift enums with associated values, and
timestamps are `Date`. The tests decode every answer in
`mobile/contract/fixtures/api/`, and fail if a procedure has none.
