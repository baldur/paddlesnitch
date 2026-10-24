import Foundation
import Testing

@testable import ContractGenKit

/// The `mobile/` directory, found from this file so the tests run from any directory.
let mobileDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // ContractGenKitTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // PaddleKit
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile

@Suite struct TokensGeneratorTests {
    @Test func committedTokensSwiftMatchesTheContract() throws {
        let json = try Data(contentsOf: mobileDir.appending(path: "contract/tokens/tokens.json"))
        let committed = try String(
            contentsOf: mobileDir.appending(
                path: "ios/Packages/PaddleKit/Sources/DesignSystem/Generated/Tokens.swift"),
            encoding: .utf8)
        #expect(
            try TokensGenerator.generate(json: json) == committed,
            "Tokens.swift is out of date: run `make generate` in mobile/ios")
    }

    @Test func committedLaunchBackgroundMatchesTheBgToken() throws {
        let json = try Data(contentsOf: mobileDir.appending(path: "contract/tokens/tokens.json"))
        let committed = try String(
            contentsOf: mobileDir.appending(
                path: "ios/App/Resources/Assets.xcassets/LaunchBackground.colorset/Contents.json"),
            encoding: .utf8)
        #expect(
            try TokensGenerator.launchBackground(json: json) == committed,
            "LaunchBackground is out of date: run `make generate` in mobile/ios")
    }

    @Test func launchBackgroundSplitsBgIntoComponents() throws {
        let json = Data(##"{"color":{"bg":"#0b1220"},"radius":{},"font":{}}"##.utf8)
        let colorset = try TokensGenerator.launchBackground(json: json)
        #expect(colorset.contains(#""red" : "0x0B""#))
        #expect(colorset.contains(#""green" : "0x12""#))
        #expect(colorset.contains(#""blue" : "0x20""#))
    }

    @Test(arguments: [
        ("bg", "bg"),
        ("surface-2", "surface2"),
        ("primary-text", "primaryText"),
        ("border-strong", "borderStrong"),
    ])
    func tokenNamesBecomeCamelCase(name: String, expected: String) throws {
        #expect(try TokensGenerator.identifier(name) == expected)
    }

    @Test(arguments: ["2x", "-bg", "bg-", "a b", ""])
    func namesThatArentIdentifiersAreRejected(name: String) {
        #expect(throws: TokensGenerator.Failure.badName(name)) {
            try TokensGenerator.identifier(name)
        }
    }

    @Test(arguments: ["0b1220", "#0b122", "#0b12200", "#gg1220", "rgb(0,0,0)"])
    func coloursThatArentRRGGBBAreRejected(value: String) {
        #expect(throws: TokensGenerator.Failure.badHex(name: "bg", value: value)) {
            try TokensGenerator.parseHex(value, name: "bg")
        }
    }

    @Test func generatesSortedSwiftForEveryGroup() throws {
        let json = Data(
            """
            {"color":{"fg":"#e2e8f0","bg":"#000a0b"},"radius":{"sheet":12,"half":0.5},"font":{"mono":"IBM Plex Mono"}}
            """.utf8)
        let swift = try TokensGenerator.generate(json: json)
        #expect(swift.contains("public static let bg = Color(hex: 0x000a0b)"))
        let bg = try #require(swift.range(of: "let bg"))
        let fg = try #require(swift.range(of: "let fg"))
        #expect(bg.lowerBound < fg.lowerBound)
        #expect(swift.contains("public static let sheet: CGFloat = 12\n"))
        #expect(swift.contains("public static let half: CGFloat = 0.5\n"))
        #expect(swift.contains("public static let mono = \"IBM Plex Mono\""))
    }
}
