import DesignSystem
import SwiftUI

/// P0 placeholder: proves the app builds, launches and uses the platform
/// theme. P1 replaces it with sign-in and Paddles.
struct HomeView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("paddlesnitch")
                .font(.system(.largeTitle, design: .monospaced, weight: .semibold))
                .foregroundStyle(Palette.fg)
                .accessibilityAddTraits(.isHeader)
            Text("The iPhone app is on its way.")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Palette.muted)
        }
        .multilineTextAlignment(.center)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.bg)
    }
}

#Preview {
    HomeView()
}
