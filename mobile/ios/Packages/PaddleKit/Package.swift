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
        .executable(name: "contract-gen", targets: ["ContractGen"]),
    ],
    targets: [
        // Colours, radii and fonts generated from mobile/contract/tokens/.
        .target(name: "DesignSystem"),
        // The server's API: models generated from mobile/contract/api/ and a
        // small tRPC client.
        .target(name: "PaddleAPI"),
        // Turns mobile/contract/ into Swift. The logic is a library so it
        // can be tested; the executable only reads and writes files.
        .target(name: "ContractGenKit"),
        .executableTarget(name: "ContractGen", dependencies: ["ContractGenKit"]),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
        .testTarget(name: "ContractGenKitTests", dependencies: ["ContractGenKit"]),
        .testTarget(name: "PaddleAPITests", dependencies: ["PaddleAPI"]),
    ]
)
