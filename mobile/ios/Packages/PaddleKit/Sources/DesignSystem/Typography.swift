import CoreText
import SwiftUI

/// IBM Plex, as on the web (docs/features/design-system.md): Sans for reading
/// and controls, Mono for numbers and short data labels. Both scale with
/// Dynamic Type through the text style they're relative to.
public enum Typography {
    /// Registers the bundled fonts with the process. Call once at launch;
    /// calling again is harmless.
    @discardableResult
    public static func registerFonts() -> Bool {
        let urls = Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        var ok = !urls.isEmpty
        for url in urls {
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                // Already registered is fine; anything else is a missing font.
                let code = (error?.takeRetainedValue()).map { CFErrorGetCode($0) }
                ok = ok && code == CTFontManagerError.alreadyRegistered.rawValue
            }
        }
        return ok
    }

    /// The point size each text style starts at before Dynamic Type, matching
    /// the web's scale (16 px body, 14 px secondary, 12 px labels).
    static func baseSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 30
        case .title: 24
        case .title2: 20
        case .title3: 18
        case .headline, .body, .callout: 16
        case .subheadline: 14
        case .footnote, .caption: 12
        case .caption2: 12
        @unknown default: 16
        }
    }
}

extension Font {
    /// IBM Plex Sans at a text style's size, scaling with Dynamic Type.
    public static func plexSans(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .custom(FontFamily.sans, size: Typography.baseSize(style), relativeTo: style).weight(weight)
    }

    /// IBM Plex Mono for numbers and data labels, with tabular digits so
    /// columns of times line up.
    public static func plexMono(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .custom(FontFamily.mono, size: Typography.baseSize(style), relativeTo: style).weight(weight).monospacedDigit()
    }

    /// Plex Mono at a size of its own (the record screen's clock), still
    /// growing and shrinking with Dynamic Type as `style` does.
    public static func plexMono(size: CGFloat, relativeTo style: Font.TextStyle, weight: Font.Weight = .regular)
        -> Font
    {
        .custom(FontFamily.mono, size: size, relativeTo: style).weight(weight).monospacedDigit()
    }
}
