import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

@Suite struct PkceTests {
    /// RFC 7636, appendix B.
    @Test func theChallengeIsTheRFCsS256() {
        #expect(
            Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func aVerifierIs32RandomBytesInBase64URL() {
        let verifier = Pkce.verifier()
        #expect(verifier.count == 43)
        #expect(verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(Pkce.verifier() != verifier)
        #expect(Pkce.challenge(verifier).count == 43)
    }
}

@Suite struct StravaCallbackTests {
    @Test func theStartPageCarriesTheChallenge() {
        let url = StravaSignIn.startURL(
            baseURL: URL(string: "https://paddlesnitch.com") ?? URL(filePath: "/"), challenge: "abc")
        #expect(url.absoluteString == "https://paddlesnitch.com/att/api/auth/strava/init?challenge=abc")
    }

    @Test func theCodeComesBackOnTheAppsScheme() throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/strava?code=xyz"))
        #expect(try StravaSignIn.code(from: callback) == "xyz")
    }

    @Test(arguments: [
        ("strava_denied", "You cancelled the Strava sign-in."),
        ("strava_profile_failed", "Couldn’t load your Strava profile. Please try again."),
        ("strava_state_mismatch", "Strava sign-in didn’t finish. Please try again."),
    ])
    func aRefusalSaysWhyInTheWebsitesWords(key: String, message: String) throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/strava?error=\(key)"))
        #expect(throws: StravaSignInError(key: key)) { try StravaSignIn.code(from: callback) }
        #expect(StravaSignInError(key: key).message == message)
    }

    @Test func noCodeAtAllDidNotFinish() throws {
        let callback = try #require(URL(string: "com.paddlesnitch.app:/signin/strava"))
        #expect(throws: StravaSignInError(key: "")) { try StravaSignIn.code(from: callback) }
    }
}

@MainActor @Suite struct StravaSignInTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()

    func account() -> AccountModel {
        AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens,
            profile: ProfileStore(defaults: { UserDefaults(suiteName: "strava-\(UUID().uuidString)") ?? .standard }))
    }

    @Test func signsInBySwappingTheCodeAndTheVerifier() async throws {
        let account = account()
        var opened: URL?
        try await account.signInWithStrava { start in
            opened = start
            return SampleServer.stravaBrowser(start)
        }
        #expect(opened?.path == "/att/api/auth/strava/init")
        #expect(account.user?.displayName == "Pat")
        #expect(tokens.load() != nil)
        let request = try #require(server.requests.last)
        #expect(request.url?.path == "/att/api/auth/strava/app-token")
        #expect(request.value(forHTTPHeaderField: "x-paddlesnitch-app") == "ios/1.0")
        let swap = try JSONDecoder().decode(StravaAppToken.self, from: try #require(request.httpBody))
        #expect(
            opened?.query == "challenge=\(Pkce.challenge(swap.verifier))", "the verifier matches the challenge sent")
    }

    @Test func aCodeCaughtWithoutTheVerifierIsUseless() async {
        let account = account()
        await #expect(
            throws: PaddleAPIError.rejected(
                message: "That sign-in has expired. Please try again.", status: 401, session: nil)
        ) {
            try await account.signInWithStrava { _ in
                SampleServer.stravaBrowser(URL(string: "https://x/init?challenge=someone-elses") ?? URL(filePath: "/"))
            }
        }
        #expect(account.state == .signedOut)
    }

    @Test func theFormShowsAStravaRefusal() async {
        let form = SignInForm()
        let ok = await form.signInWithStrava(to: account()) { _ in
            URL(string: "com.paddlesnitch.app:/signin/strava?error=strava_denied") ?? URL(filePath: "/")
        }
        #expect(!ok)
        #expect(form.error == "You cancelled the Strava sign-in.")
        #expect(!form.busy)
    }

    @Test func closingTheSignInPageLeavesNoError() async {
        let form = SignInForm()
        #expect(await form.signInWithStrava(to: account()) { _ in throw CancellationError() } == false)
        #expect(form.error == nil)
        #expect(server.requests.isEmpty)
    }

    @Test func theFormSignsInWithStrava() async {
        let account = account()
        let form = SignInForm()
        #expect(await form.signInWithStrava(to: account, browser: SampleServer.stravaBrowser))
        #expect(account.user != nil)
    }
}
