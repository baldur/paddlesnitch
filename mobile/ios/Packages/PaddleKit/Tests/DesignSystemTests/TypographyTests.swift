import CoreText
import Foundation
import Testing

@testable import DesignSystem

@Suite struct TypographyTests {
    init() {
        Typography.registerFonts()
    }

    @Test func registeringTwiceIsHarmless() {
        #expect(Typography.registerFonts())
        #expect(Typography.registerFonts())
    }

    /// Core Text falls back to a system font for an unknown name, so check the
    /// family that actually comes back.
    @Test(arguments: [FontFamily.sans, FontFamily.mono])
    func theTokenFamiliesResolveToTheBundledFonts(family: String) {
        let font = CTFontCreateWithName(family as CFString, 16, nil)
        #expect(CTFontCopyFamilyName(font) as String == family)
    }

    @Test(arguments: ["IBMPlexMono-Regular", "IBMPlexMono-Medium", "IBMPlexMono-SemiBold", "IBMPlexMono-Bold"])
    func everyMonoWeightIsBundled(postScriptName: String) {
        let font = CTFontCreateWithName(postScriptName as CFString, 16, nil)
        #expect(CTFontCopyPostScriptName(font) as String == postScriptName)
    }

    @Test func theFontLicenceShipsWithTheFonts() {
        #expect(Bundle.module.url(forResource: "OFL", withExtension: "txt", subdirectory: "Fonts") != nil)
    }

    @Test func bodyTextStartsAtTheWebsSixteenPoints() {
        #expect(Typography.baseSize(.body) == 16)
        #expect(Typography.baseSize(.subheadline) == 14)
        #expect(Typography.baseSize(.caption) == 12)
    }
}
