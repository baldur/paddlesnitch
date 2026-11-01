import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// Google sign-in and the sign-in options (mobile/contract/README.md,
/// Signing in → "Google").
@Suite struct GoogleCallbackTests {
    @Test func theStartPageCarriesTheChallenge() {
        let url = GoogleSignIn.startURL(
            baseURL: URL(string: "https://paddlesnitch.com") ?? URL(filePath: "/"), challenge: "abc")
        #expect(url.absoluteString == "https://paddlesnitch.com/att/api/auth/google/init?challenge=abc")
    }

    @Test func theCodeComesBackOnTheAppsScheme() throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/google?code=xyz"))
        #expect(try GoogleSignIn.code(from: callback) == "xyz")
    }

    @Test(arguments: [
        ("google_account_exists", "You already have an account with this email. Sign in with your email instead."),
        (
            "google_no_email",
            "Couldn’t sign in with Google, because Google didn’t share a confirmed email address. "
                + "Please sign up with your email instead."
        ),
        ("google_denied", "You cancelled the Google sign-in."),
        ("google_failed", "Couldn’t sign in with Google. Please try again."),
        ("google_not_configured", "Google sign-in isn’t available right now."),
        ("something_new", "Couldn’t sign in with Google. Please try again."),
    ])
    func aRefusalSaysWhyInTheContractsWords(key: String, message: String) throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/google?error=\(key)"))
        #expect(throws: GoogleSignInError(key: key)) {
            try GoogleSignIn.code(from: callback)
        }
        #expect(GoogleSignInError(key: key).message == message)
    }

    @Test func noCodeAtAllDidNotFinish() throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/google"))
        #expect(throws: GoogleSignInError(key: "")) {
            try GoogleSignIn.code(from: callback)
        }
    }
}

@MainActor @Suite struct GoogleSignInTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()

    func account() -> AccountModel {
        AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens,
            profile: ProfileStore(defaults: { UserDefaults(suiteName: "google-\(UUID().uuidString)") ?? .standard }))
    }

    @Test func signsInBySwappingTheCodeAndTheVerifier() async throws {
        let account = account()
        var opened: URL?
        try await account.signInWithGoogle { start in
            opened = start
            return SampleServer.googleBrowser(start)
        }
        #expect(opened?.path == "/att/api/auth/google/init")
        #expect(account.user?.displayName == "Pat")
        #expect(tokens.load() != nil)
        let request = try #require(server.requests.last)
        #expect(request.url?.path == "/att/api/auth/google/app-token")
        let swap = try JSONDecoder().decode(GoogleAppToken.self, from: try #require(request.httpBody))
        #expect(opened?.query == "challenge=\(Pkce.challenge(swap.verifier))")
    }

    @Test func aCodeCaughtWithoutTheVerifierIsUseless() async {
        let account = account()
        await #expect(throws: PaddleAPIError.self) {
            try await account.signInWithGoogle { _ in
                SampleServer.googleBrowser(URL(string: "https://x/init?challenge=someone-elses") ?? URL(filePath: "/"))
            }
        }
        #expect(account.state == .signedOut)
    }

    @Test func theFormShowsARefusalAndSaysNothingWhenClosed() async {
        let form = SignInForm()
        let refused = await form.signInWithGoogle(to: account()) { _ in
            URL(string: "com.paddlesnitch.app:/signin/google?error=google_denied") ?? URL(filePath: "/")
        }
        #expect(!refused)
        #expect(form.error == "You cancelled the Google sign-in.")
        let closed = await form.signInWithGoogle(to: account()) { _ in throw CancellationError() }
        #expect(!closed)
        #expect(form.error == nil)
    }

    /// Strava has gone: an older server that still says `strava: true`
    /// changes nothing, and the words never offer Strava.
    @Test func stravaInTheOptionsIsIgnored() async {
        let account = account()
        server.options = SignInOptions(google: true, strava: true)
        await account.loadOptions()
        let form = SignInForm()
        _ = await form.signInWithGoogle(to: account) { _ in
            URL(string: "com.paddlesnitch.app:/signin/google?error=google_account_exists") ?? URL(filePath: "/")
        }
        #expect(form.error == "You already have an account with this email. Sign in with your email instead.")
        #expect(!server.requests.contains { $0.url?.path().lowercased().contains("strava") == true })
    }

    @Test func optionsAreEmailOnlyUntilAnsweredAndAFailedAskKeepsTheLastAnswer() async {
        let account = account()
        server.options = nil
        await account.loadOptions()
        #expect(account.options == .emailOnly, "never answered: email only")
        server.options = SignInOptions(google: true, strava: false)
        await account.loadOptions()
        #expect(account.options == SignInOptions(google: true, strava: false))
        server.options = nil
        await account.loadOptions()
        #expect(account.options == SignInOptions(google: true, strava: false), "kept")
    }

    @Test func theStravaLineIsTheDecidedWords() {
        #expect(SignInHelp.madeWithStrava == "Made your account with Strava? Email us and we’ll move it to your email.")
    }

    @Test func emailUsGoesToPrivacyWithTheSubject() {
        #expect(
            SignInHelp.emailUs.absoluteString
                == "mailto:privacy@paddlesnitch.com?subject=Signing%20in%20without%20Strava")
    }

    @Test func theReportPageIsSignedInAsThisAccount() async throws {
        let account = account()
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        let url = try await account.reportPage()
        #expect(url.path() == SampleServer.webCodePath)
        let next = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "next" }
        #expect(next?.value == "/account?report=1")
        let request = try #require(server.requests.last)
        #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
        let asked = try JSONDecoder().decode(WebPageFor.self, from: try #require(request.httpBody))
        #expect(asked.next == "/account?report=1")
    }

    @Test func aFirstFailedAskSaysSoUntilOneWorks() async {
        let account = account()
        server.options = nil
        await account.loadOptions()
        #expect(account.optionsFailed)
        server.options = SignInOptions(google: true, strava: false)
        await account.loadOptions()
        #expect(!account.optionsFailed)
        server.options = nil
        await account.loadOptions()
        #expect(!account.optionsFailed, "an answer is known")
    }

    @Test func theOptionsFixturesDecode() throws {
        for name in ["auth.options", "auth.options.email-only"] {
            let data = try Data(contentsOf: fixtures.appending(path: "\(name).json"))
            _ = try JSONDecoder().decode(SignInOptions.self, from: data)
        }
    }
}
