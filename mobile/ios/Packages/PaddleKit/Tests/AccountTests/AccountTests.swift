import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // AccountTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // PaddleKit
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile
    .appending(path: "contract/fixtures/api")

/// A JWT whose only claim is `exp`, `seconds` from now. Unsigned: the app
/// never checks signatures, only when to refresh.
func jwt(expiresIn seconds: TimeInterval, now: Date = Date()) -> String {
    let payload = #"{"exp":\#(Int(now.timeIntervalSince1970 + seconds))}"#
    let base64 = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
    return "eyJhbGciOiJub25lIn0.\(base64).c2ln"
}

/// Counts refreshes and answers with a fixed result.
actor RefreshCounter {
    private(set) var count = 0
    func refresh(_ answer: Result<String, any Error>, delay: Duration = .zero) async throws -> String {
        count += 1
        try await Task.sleep(for: delay)
        return try answer.get()
    }
}

@Suite struct JWTTests {
    @Test func readsTheExpiry() throws {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let expiry = try #require(JWT.expiry(jwt(expiresIn: 600, now: now)))
        #expect(expiry == Date(timeIntervalSince1970: 1_000_600))
    }

    @Test func aTokenWithoutAReadableExpiryCountsAsExpiring() {
        #expect(JWT.expires("not-a-jwt", within: 60, now: Date()))
        #expect(JWT.expires("a.eyJzdWIiOiJ1In0.b", within: 60, now: Date()), "no exp claim")
    }
}

@Suite struct TokenSessionTests {
    @Test func aTokenWithTimeLeftIsReusedWithoutRefreshing() async throws {
        let counter = RefreshCounter()
        let session = TokenSession(store: MemoryTokenStore("r")) { _ in try await counter.refresh(.success("new")) }
        let token = jwt(expiresIn: 3600)
        try await session.signedIn(idToken: token, refreshToken: "r")
        #expect(try await session.token() == .token(token))
        #expect(await counter.count == 0)
    }

    @Test func aTokenAboutToExpireIsRefreshed() async throws {
        let counter = RefreshCounter()
        let session = TokenSession(store: MemoryTokenStore("r")) { _ in try await counter.refresh(.success("new")) }
        try await session.signedIn(idToken: jwt(expiresIn: 30), refreshToken: "r")
        #expect(try await session.token() == .token("new"))
        #expect(await counter.count == 1)
    }

    @Test func callsArrivingTogetherShareOneRefresh() async throws {
        let counter = RefreshCounter()
        let session = TokenSession(store: MemoryTokenStore("r")) { _ in
            try await counter.refresh(.success("new"), delay: .milliseconds(50))
        }
        let outcomes = await withTaskGroup(of: TokenSession.Outcome?.self) { group in
            for _ in 0..<5 { group.addTask { try? await session.token() } }
            return await group.reduce(into: []) { $0.append($1) }
        }
        #expect(outcomes.allSatisfy { $0 == .token("new") })
        #expect(await counter.count == 1)
    }

    @Test func aRefusedRefreshTokenSignsOutAndIsForgotten() async throws {
        let store = MemoryTokenStore("r")
        let refused = PaddleAPIError.rejected(message: "no", status: 401, session: nil)
        let session = TokenSession(store: store) { _ in throw refused }
        #expect(try await session.token() == .signedOut)
        #expect(store.load() == nil)
    }

    @Test func aNetworkFailureKeepsTheRefreshToken() async {
        let store = MemoryTokenStore("r")
        let session = TokenSession(store: store) { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: URLError.self) { try await session.token() }
        #expect(store.load() == "r", "offline isn't signed out")
    }

    @Test func withoutARefreshTokenThereIsNoAccount() async throws {
        let session = TokenSession(store: MemoryTokenStore()) { _ in "never" }
        #expect(try await session.token() == .signedOut)
        #expect(await !session.hasAccount)
    }

    @Test func signingOutForgetsBothTokensAndHandsBackTheRefreshToken() async throws {
        let store = MemoryTokenStore()
        let session = TokenSession(store: store) { _ in "new" }
        try await session.signedIn(idToken: jwt(expiresIn: 3600), refreshToken: "r")
        #expect(await session.signOut() == "r")
        #expect(store.load() == nil)
        #expect(try await session.token() == .signedOut)
    }
}

@MainActor @Suite struct AccountModelTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()
    let defaults: UserDefaults
    let profile: ProfileStore

    init() {
        let suite = "account-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite) ?? .standard
        let name = suite
        profile = ProfileStore(defaults: { UserDefaults(suiteName: name) ?? .standard })
    }

    func account() -> AccountModel {
        AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens, profile: profile)
    }

    @Test func signingInKeepsTheRefreshTokenAndSaysWho() async throws {
        let account = account()
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        #expect(account.user?.displayName == "Pat")
        #expect(account.user?.needsTerms == false)
        #expect(tokens.load()?.isEmpty == false)
        #expect(server.requests.last?.value(forHTTPHeaderField: "x-paddlesnitch-app") == "ios/1.0")
    }

    @Test func aWrongPasswordIsRefusedInTheServersWords() async {
        let account = account()
        await #expect(
            throws: PaddleAPIError.rejected(message: "That email and password don’t match.", status: 401, session: nil)
        ) {
            try await account.signIn(email: "pat@example.com", password: "nope")
        }
        #expect(account.state == .signedOut)
        #expect(tokens.load() == nil)
    }

    @Test func anOlderAccountIsToldToAcceptTheTerms() async throws {
        let account = account()
        try await account.signIn(email: SampleServer.needsTermsEmail, password: SampleServer.password)
        #expect(account.user?.needsTerms == true)
    }

    @Test func creatingAnAccountAgreesToTheCurrentTerms() async throws {
        let account = account()
        try await account.createAccount(email: "new@example.com", displayName: "New", password: "Secret123")
        let body = try #require(server.requests.last?.httpBody)
        #expect(try JSONDecoder().decode(Signup.self, from: body).acceptedTosVersion == Constants.tosVersion)
        #expect(account.user != nil)
    }

    @Test func callsAfterSigningInGoAsTheUser() async throws {
        let account = account()
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        let list = try await account.client.call(Procedures.paddlesList)
        #expect(!list.cards.isEmpty)
        #expect(server.requests.last?.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
    }

    @Test func theNextLaunchIsSignedInWithoutTheNetwork() async throws {
        try await account().signIn(email: "pat@example.com", password: SampleServer.password)
        let before = server.requests.count
        let relaunched = account()
        #expect(relaunched.user?.displayName == "Pat")
        #expect(server.requests.count == before)
    }

    @Test func signingOutRevokesTheRefreshToken() async throws {
        let account = account()
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        let refreshToken = try #require(tokens.load())
        await account.signOut()
        #expect(account.state == .signedOut)
        #expect(tokens.load() == nil)
        #expect(server.revokedTokens.contains(refreshToken))
        #expect(self.account().user == nil, "and stays signed out on the next launch")
    }

    @Test func aRefreshTokenTheServerTurnsDownSignsOut() async throws {
        let account = account()
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        server.refusesRefresh = true
        // The fixture's ID token has no expiry, so the next call refreshes.
        await #expect(throws: PaddleAPIError.signedOut) {
            try await account.client.call(Procedures.paddlesList)
        }
        #expect(account.state == .signedOut)
    }
}

/// A Keychain that turns everything down, like an unsigned build's.
final class RefusingTokenStore: TokenStore, @unchecked Sendable {
    func load() -> String? { nil }
    func save(_ refreshToken: String) throws { throw TokenStoreError(status: -34018) }
    func clear() {}
}

@MainActor @Suite struct SignInFormTests {
    @Test func aPhoneThatWontKeepTheTokenSaysSoInsteadOfSigningIn() async {
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"),
            transport: SampleServer(fixtures: fixtures), app: "ios/1.0", tokens: RefusingTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: "refusing") ?? .standard }))
        let form = SignInForm()
        form.email = "pat@example.com"
        form.password = SampleServer.password
        #expect(await form.submit(to: account) == false)
        #expect(form.error == "Signed in, but this iPhone wouldn't keep you signed in. Try again.")
        #expect(account.state == .signedOut)
    }

    func account() -> AccountModel {
        AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"),
            transport: SampleServer(fixtures: fixtures), app: "ios/1.0", tokens: MemoryTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: "form-tests") ?? .standard }))
    }

    @Test func emptyFieldsAreCaughtBeforeSending() async {
        let form = SignInForm()
        form.email = "pat@example.com"
        #expect(await form.submit(to: account()) == false)
        #expect(form.error == "Fill in every field.")
    }

    @Test func creatingAnAccountNeedsTheTermsTicked() async {
        let form = SignInForm()
        form.mode = .createAccount
        form.email = "a@b.c"
        form.displayName = "A"
        form.password = "Secret123"
        #expect(await form.submit(to: account()) == false)
        #expect(form.error == "You must agree to the Terms of Service to create an account.")
    }

    @Test func theServersRefusalIsShownAsIs() async {
        let form = SignInForm()
        form.email = "pat@example.com"
        form.password = "wrong"
        #expect(await form.submit(to: account()) == false)
        #expect(form.error == "That email and password don’t match.")
    }

    @Test func signingInClearsThePassword() async {
        let form = SignInForm()
        form.email = "  pat@example.com "
        form.password = SampleServer.password
        #expect(await form.submit(to: account()))
        #expect(form.password.isEmpty)
        #expect(form.error == nil)
    }

    @Test func switchingModeClearsTheError() async {
        let form = SignInForm()
        #expect(await form.submit(to: account()) == false)
        form.mode = .createAccount
        #expect(form.error == nil)
        #expect(form.buttonTitle == "Create account")
    }
}
