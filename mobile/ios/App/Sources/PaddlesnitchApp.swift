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
    /// `-ResetAccount` starts signed out; `-PendingSummaries` opens paddles
    /// whose summaries are still to be written.
    private static func makeAccount(fixtures: URL) -> AccountModel {
        let arguments = ProcessInfo.processInfo.arguments
        let sample = usesSampleServer
        let tokens = KeychainTokenStore(service: "com.paddlesnitch.app.refresh-token" + (sample ? ".sample" : ""))
        let profile = ProfileStore(key: "signed-in-user" + (sample ? ".sample" : ""))
        if arguments.contains("-ResetAccount") {
            tokens.clear()
            UserDefaults.standard.removeObject(forKey: profile.key)
        }
        let server = SampleServer(fixtures: fixtures, summariesPending: arguments.contains("-PendingSummaries"))
        // UI tests: an old sign-in, so deleting asks for a new one.
        if arguments.contains("-StaleSignIn") { server.signInIsRecent = false }
        // UI tests: a session restored from a Strava sign-in.
        if arguments.contains("-StravaAccount") { server.placeholderEmail = true }
        // UI tests: Strava switched off on the server, as production now.
        if arguments.contains("-StravaOff") { server.options = SignInOptions(google: true, strava: false) }
        // UI tests: Strava goes off after the app's first ask.
        if arguments.contains("-StravaOffLater") { server.optionsLater = SignInOptions(google: true, strava: false) }
        // UI tests: asking which ways in are on fails.
        if arguments.contains("-OptionsFail") { server.options = nil }
        // UI tests: Strava was connected before it was switched off.
        if arguments.contains("-StravaConnected") { server.stravaConnected = true }
        // Phone recordings (C3): what the server does with an upload.
        let uploads: [String: PhoneUploads] = [
            "-UploadsDown": .down, "-UploadsRefused": .refused, "-UploadsNoFix": .noFix,
            "-AccountDeleted": .accountDeleted,
        ]
        if let answer = uploads.first(where: { arguments.contains($0.key) })?.value { server.phoneUploads = answer }
        server.phoneRemoved = arguments.contains("-PhoneRemoved")
        let transport: any HTTPTransport = sample ? server : URLSession.shared
        let account = AccountModel(
            baseURL: baseURL, transport: transport, app: "ios/\(YouView.shortVersion)", tokens: tokens,
            profile: profile)
        if sample {
            // UI tests: recordings of their own, none left from the last test.
            let root = URL.documentsDirectory.appending(path: "SampleRecordings", directoryHint: .isDirectory)
            try? FileManager.default.removeItem(at: root)
            account.recordingsRoot = root
        }
        return account
    }

    static var usesSampleServer: Bool { ProcessInfo.processInfo.arguments.contains("-SampleServer") }

    /// A password field's autofill type. Not with the sample server (UI
    /// tests): there iOS's "Use Strong Password?" and "Save Password?"
    /// cover the screen and swallow keys, differently on each iOS.
    static func password(_ type: UITextContentType) -> UITextContentType? {
        usesSampleServer ? nil : type
    }

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
