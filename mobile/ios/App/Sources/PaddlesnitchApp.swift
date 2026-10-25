import Account
import DesignSystem
import PaddleAPI
import Paddles
import SampleServer
import SwiftUI

@main
struct PaddlesnitchApp: App {
    @State private var account: AccountModel
    private let samples: SamplePaddles

    init() {
        Typography.registerFonts()
        let fixtures = Bundle.main.url(forResource: "api", withExtension: nil) ?? Bundle.main.bundleURL
        samples = SamplePaddles(directory: fixtures)
        _account = State(initialValue: Self.makeAccount(fixtures: fixtures))
    }

    var body: some Scene {
        WindowGroup {
            RootView(account: account, samples: samples)
        }
    }

    /// The real server, or with `-SampleServer` (UI tests) one played from the
    /// contract's fixtures, with its own Keychain entry so the two never mix.
    /// `-ResetAccount` starts signed out.
    private static func makeAccount(fixtures: URL) -> AccountModel {
        let arguments = ProcessInfo.processInfo.arguments
        let sample = usesSampleServer
        let tokens = KeychainTokenStore(service: "com.paddlesnitch.app.refresh-token" + (sample ? ".sample" : ""))
        let profile = ProfileStore(key: "signed-in-user" + (sample ? ".sample" : ""))
        if arguments.contains("-ResetAccount") {
            tokens.clear()
            UserDefaults.standard.removeObject(forKey: profile.key)
        }
        let transport: any HTTPTransport = sample ? SampleServer(fixtures: fixtures) : URLSession.shared
        return AccountModel(
            baseURL: baseURL, transport: transport, app: "ios/\(YouView.shortVersion)", tokens: tokens,
            profile: profile)
    }

    static var usesSampleServer: Bool { ProcessInfo.processInfo.arguments.contains("-SampleServer") }

    static var baseURL: URL {
        #if DEBUG
            if let override = ProcessInfo.processInfo.environment["PADDLESNITCH_BASE_URL"],
                let url = URL(string: override)
            {
                return url
            }
        #endif
        let configured = Bundle.main.object(forInfoDictionaryKey: "PaddlesnitchBaseURL") as? String
        return URL(string: configured ?? "https://paddlesnitch.com") ?? URL(filePath: "/")
    }
}
