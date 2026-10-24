import DesignSystem
import Paddles
import SwiftUI

@main
struct PaddlesnitchApp: App {
    /// Sample paddles until sign-in arrives (C2); then the server, behind it.
    private let paddles: any PaddlesSource = SamplePaddles(
        directory: Bundle.main.url(forResource: "api", withExtension: nil) ?? Bundle.main.bundleURL)

    init() {
        Typography.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView(paddles: paddles, isSample: true)
        }
    }
}
