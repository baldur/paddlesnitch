# mobile/ios — the iPhone app

Swift + SwiftUI, iOS 17 and up. Spec: [`docs/features/ios-app.md`](../../docs/features/ios-app.md).
Shared with Android: [`mobile/contract/`](../contract/README.md). Not a pnpm
package; `pnpm test` doesn't touch it.

## One-time setup

1. Xcode from the App Store, then `sudo xcodebuild -license accept` and
   `sudo xcodebuild -runFirstLaunch`.
2. Simulators: `xcodebuild -downloadPlatform iOS` (newest) and
   `xcodebuild -downloadPlatform iOS -buildVersion 17.5` (the floor).
3. Tools: `brew install xcodegen swiftlint xcbeautify`.

No Apple Developer account is needed until P5 (TestFlight); the simulator runs
everything.

## Day to day

```
make open             generate the Xcode project and open it (▶ runs the app)
make test             package tests, then app tests on the newest simulator
make test-app IOS=17  app tests on iOS 17
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
| `Packages/PaddleKit/` | Everything testable without a simulator, one target per area (`DesignSystem` now; `PaddleAPI`, `Recorder`, `TrackerLink`, `UploadQueue`, `Capabilities` as their phases arrive). `swift test` runs it on the Mac. |
| `Packages/PaddleKit/Sources/ContractGen*` | `contract-gen`: `mobile/contract/` → Swift. |
| `Tests/UI/` | XCUITest: launch flows and Apple's accessibility audit. |
| `scripts/simulator.sh` | Finds or creates an iPhone simulator for an iOS version. |

## Generated files

`DesignSystem/Generated/Tokens.swift` and the `LaunchBackground` colour come
from `mobile/contract/tokens/tokens.json`. Don't edit them: run
`make generate`. A package test fails while they're out of date.
