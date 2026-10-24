import DesignSystem
import Paddles
import SwiftUI

/// The bottom tab bar. The web's phone layout has Paddles, Trials, Plan and
/// You (docs/features/design-system.md); Trials arrives in P4.
struct RootView: View {
    let paddles: any PaddlesSource
    let isSample: Bool

    var body: some View {
        TabView {
            PaddleListView(source: paddles, isSample: isSample)
                .tabItem { Label("Paddles", systemImage: "water.waves") }
            YouView()
                .tabItem { Label("You", systemImage: "person.crop.circle") }
        }
        .tint(Palette.primaryText)
        .preferredColorScheme(.dark)
    }
}
