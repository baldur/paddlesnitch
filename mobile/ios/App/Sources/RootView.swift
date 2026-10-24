import Account
import DesignSystem
import Paddles
import SwiftUI

/// The bottom tab bar. The web's phone layout has Paddles, Trials, Plan and
/// You (docs/features/design-system.md); Trials arrives in P4.
struct RootView: View {
    let account: AccountModel
    let samples: SamplePaddles
    @State private var signingIn = false

    var body: some View {
        TabView {
            // The same list view throughout; it reloads when `sourceID` changes
            // (samples, or this person's). Rebuilding its navigation stack
            // under the closing sign-in sheet crashed UIKit on iOS 17.
            PaddleListView(
                source: source, sourceID: account.user?.id ?? "samples", isSample: account.user == nil,
                needsTerms: account.user?.needsTerms == true, signIn: { signingIn = true }
            )
            .tabItem { Label("Paddles", systemImage: "water.waves") }
            YouView(account: account, signIn: { signingIn = true })
                .tabItem { Label("You", systemImage: "person.crop.circle") }
        }
        .tint(Palette.primaryText)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $signingIn) {
            SignInView(account: account)
        }
    }

    private var source: any PaddlesSource {
        account.user == nil ? samples : ServerPaddles(client: account.client)
    }
}
