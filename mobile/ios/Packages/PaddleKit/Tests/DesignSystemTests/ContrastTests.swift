import SwiftUI
import Testing

@testable import DesignSystem

/// WCAG contrast for every colour pairing the screens use, computed from the
/// tokens. Contrast is a property of the palette, so it's checked here, the
/// same on every iOS version. Apple's on-screen audit measures text through
/// iOS 26's glass bars, which blur what scrolls under them on purpose.
@Suite struct ContrastTests {
    static let backgrounds: [(String, Color)] = [
        ("bg", Palette.bg), ("surface", Palette.surface), ("surface2", Palette.surface2),
    ]

    /// Every colour text is drawn in.
    static let textColours: [(String, Color)] = [
        ("fg", Palette.fg), ("muted", Palette.muted), ("primaryText", Palette.primaryText),
        ("split", Palette.split), ("red", Palette.red), ("green", Palette.green),
    ]

    @Test(arguments: textColours)
    func textIsReadableOnEveryBackground(name: String, colour: Color) {
        for (background, ground) in Self.backgrounds {
            let ratio = Contrast.ratio(colour, ground)
            #expect(ratio >= 4.5, "\(name) on \(background) is \(ratio):1, text needs 4.5:1")
        }
    }

    /// Graphics that carry meaning (the logbook's bars, the route's start dot)
    /// need 3:1 against the card they sit on.
    @Test(arguments: [("primaryText", Palette.primaryText), ("fg", Palette.fg), ("green", Palette.green)])
    func graphicsStandOutFromTheCard(name: String, colour: Color) {
        #expect(Contrast.ratio(colour, Palette.surface) >= 3, "\(name) on surface")
    }

    /// The button blue is for filled buttons with white text, not for text.
    @Test func whiteTextReadsOnTheButtonBlue() {
        #expect(Contrast.ratio(.white, Palette.primary) >= 4.5)
        #expect(Contrast.ratio(Palette.primary, Palette.surface) < 4.5, "why primaryText exists")
    }

    @Test func theFormulaMatchesWCAGsOwnExamples() {
        #expect(abs(Contrast.ratio(.black, .white) - 21) < 0.01)
        #expect(abs(Contrast.ratio(Color(hex: 0x777777), .white) - 4.48) < 0.01)
    }
}

/// WCAG 2 relative luminance and contrast ratio.
enum Contrast {
    static func ratio(_ a: Color, _ b: Color) -> Double {
        let (high, low) = (max(luminance(a), luminance(b)), min(luminance(a), luminance(b)))
        return (high + 0.05) / (low + 0.05)
    }

    static func luminance(_ colour: Color) -> Double {
        let resolved = colour.resolve(in: EnvironmentValues())
        // `Color.Resolved` components are already linear sRGB.
        return 0.2126 * Double(resolved.linearRed) + 0.7152 * Double(resolved.linearGreen)
            + 0.0722 * Double(resolved.linearBlue)
    }
}
