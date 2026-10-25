import DesignSystem
import SwiftUI

/// A visible label above an input, help below (design-system.md): the
/// sign-in and forgot-password forms.
struct FormField<Input: View>: View {
    let label: String
    var help: String?
    @ViewBuilder let input: () -> Input

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.fg)
            input()
                .font(.plexSans(.body))
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Palette.surface)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                .accessibilityLabel(label)
            if let help {
                Text(help).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            }
        }
    }
}
