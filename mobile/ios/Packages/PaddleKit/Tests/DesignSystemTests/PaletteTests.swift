import SwiftUI
import Testing

@testable import DesignSystem

@Suite struct PaletteTests {
    @Test func hexBecomesTheSameSRGBColour() {
        let resolved = Color(hex: 0x0b1220).resolve(in: EnvironmentValues())
        #expect(abs(Double(resolved.red) - 0x0b / 255.0) < 0.001)
        #expect(abs(Double(resolved.green) - 0x12 / 255.0) < 0.001)
        #expect(abs(Double(resolved.blue) - 0x20 / 255.0) < 0.001)
        #expect(resolved.opacity == 1)
    }

    @Test func backgroundIsTheWebsDarkBackground() {
        #expect(Palette.bg == Color(hex: 0x0b1220))
    }
}
