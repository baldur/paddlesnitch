// swift-tools-version: 6.0
import PackageDescription

// The iPhone app's logic, outside the app target so `swift test` runs it on
// the Mac in seconds without a simulator. See docs/features/ios-app.md.
let package = Package(
    name: "PaddleKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .library(name: "PaddleAPI", targets: ["PaddleAPI"]),
        .library(name: "Paddles", targets: ["Paddles"]),
        .library(name: "Account", targets: ["Account"]),
        .library(name: "SampleServer", targets: ["SampleServer"]),
        .library(name: "Recorder", targets: ["Recorder"]),
        .executable(name: "contract-gen", targets: ["ContractGen"]),
    ],
    dependencies: [
        // The shared C recorder core (recorder-core/ at the repo root).
        .package(name: "RecorderCore", path: "../../../../recorder-core")
    ],
    targets: [
        // Colours, radii and fonts generated from mobile/contract/tokens/.
        .target(name: "DesignSystem", resources: [.copy("Resources/Fonts")]),
        // The server's API: models generated from mobile/contract/api/ and a
        // small tRPC client.
        .target(name: "PaddleAPI"),
        // The Paddles screens' logic: formatting as the web does, the route's
        // colour scale, and the list and one-paddle models.
        .target(name: "Paddles", dependencies: ["PaddleAPI"]),
        // Signing in: tokens in the Keychain, refreshing them, who's signed in.
        .target(name: "Account", dependencies: ["PaddleAPI"]),
        // paddlesnitch.com played from the contract's fixtures, for UI tests.
        .target(name: "SampleServer", dependencies: ["PaddleAPI"]),
        // Recording on the phone: sensor events into the recorder core's phone
        // layer, its lines into the tracker's files.
        .target(name: "Recorder", dependencies: [.product(name: "RecorderCore", package: "RecorderCore")]),
        // Turns mobile/contract/ into Swift. The logic is a library so it
        // can be tested; the executable only reads and writes files.
        .target(name: "ContractGenKit"),
        .executableTarget(name: "ContractGen", dependencies: ["ContractGenKit"]),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
        .testTarget(name: "ContractGenKitTests", dependencies: ["ContractGenKit"]),
        .testTarget(name: "PaddleAPITests", dependencies: ["PaddleAPI"]),
        .testTarget(name: "PaddlesTests", dependencies: ["Paddles", "PaddleAPI", "SampleServer"]),
        .testTarget(name: "RecorderTests", dependencies: ["Recorder"]),
        .testTarget(name: "AccountTests", dependencies: ["Account", "PaddleAPI", "SampleServer"]),
    ]
)
