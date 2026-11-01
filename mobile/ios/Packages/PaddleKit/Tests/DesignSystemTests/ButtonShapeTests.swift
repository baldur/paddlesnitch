import Foundation
import SwiftUI
import Testing

@testable import DesignSystem

/// #793: app buttons take the token's control radius, not a capsule. The
/// drawn shape is checked in the UI tests (`ButtonShapeTests` there): outside
/// a button, `ButtonBorderShape.path` is a plain rectangle.
@Suite struct ButtonShapeTests {
    static let tokens = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // DesignSystemTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // PaddleKit
        .deletingLastPathComponent()  // Packages
        .deletingLastPathComponent()  // ios
        .deletingLastPathComponent()  // mobile
        .appending(path: "contract/tokens/tokens.json")

    struct Tokens: Decodable { let radius: [String: Double] }

    @Test func theControlRadiusIsTheTokens() throws {
        let tokens = try JSONDecoder().decode(Tokens.self, from: Data(contentsOf: Self.tokens))
        #expect(Double(Radius.control) == tokens.radius["control"])
    }

    @Test func buttonsUseTheControlRadius() {
        #expect(ButtonBorderShape.control == .roundedRectangle(radius: Radius.control))
        #expect(ButtonBorderShape.control != .roundedRectangle(radius: Radius.sheet), "the radius counts")
        #expect(ButtonBorderShape.control != .capsule)
        #expect(ButtonBorderShape.control != .automatic)
    }
}
