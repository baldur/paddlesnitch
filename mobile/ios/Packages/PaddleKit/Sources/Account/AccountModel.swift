import Foundation
import Observation
import PaddleAPI

/// Who's signed in, and the client their calls go through.
@MainActor @Observable
public final class AccountModel {
    public struct User: Codable, Equatable, Sendable {
        public var id: String
        public var email: String
        public var displayName: String
        /// The account must accept changed Terms on the website. Known only
        /// from signing in; a restored session says false.
        public var needsTerms: Bool
    }

    public enum State: Equatable, Sendable {
        case signedOut
        case signedIn(User)
    }

    public internal(set) var state: State = .signedOut
    /// The account was just deleted here: the signed-out You tab says so.
    public internal(set) var accountDeleted = false
    /// Signed out to sign in again before deleting: come straight back to it.
    public internal(set) var afterSignIn: AfterSignIn?
    /// Who signed out to sign in again: only they come straight back.
    public internal(set) var signInAgainUserId: String?
    /// The app's sign-in sheet is up or still closing: another sheet can't
    /// open yet (iOS drops it without a word). Set by the app; kept here, as
    /// iOS 17 doesn't pass environment changes to pushed screens.
    public var signInSheetUp = false
    /// The recordings made on this phone, a folder per account
    /// (`recordings(for:)`). Tests point it elsewhere.
    public var recordingsRoot = AccountModel.recordingsRoot
    /// The ways in the server offers besides email: none until asked, and
    /// none if asking fails (mobile/contract/README.md, Signing in).
    public internal(set) var options = SignInOptions.emailOnly
    /// The ask failed and nothing was known before: say so, with Try again.
    public internal(set) var optionsFailed = false
    /// The email to sign in again with.
    public internal(set) var signInAgainEmail: String?
    /// Why the app signed out by itself, for the sign-in screen: the
    /// server's words when the account was deleted elsewhere (410).
    public internal(set) var signedOutBecause: String?
    /// Who the server last said made their account with Strava (its
    /// sign-in email is a placeholder): `madeWithStrava` is for them only.
    var madeWithStravaUserId: String?
    /// Calls as the signed-in user (Bearer ID token, refreshed as needed).
    public private(set) var client: PaddleClient
    public var user: User? {
        if case .signedIn(let user) = state { user } else { nil }
    }

    let anonymous: PaddleClient
    let session: TokenSession
    let profile: ProfileStore

    public init(
        baseURL: URL, transport: any HTTPTransport, app: String, tokens: any TokenStore,
        profile: ProfileStore = ProfileStore()
    ) {
        let anonymous = PaddleClient(baseURL: baseURL, transport: transport, app: app, idToken: { _ in nil })
        let session = TokenSession(store: tokens) { refreshToken in
            try await anonymous.send(Endpoints.authRefresh, RefreshToken(refreshToken: refreshToken)).idToken
        }
        self.anonymous = anonymous
        self.session = session
        self.profile = profile
        self.client = anonymous
        self.client = PaddleClient(baseURL: baseURL, transport: transport, app: app) { [weak self] refresh in
            switch try await session.token(refresh: refresh) {
            case .token(let token): return token
            case .signedOut:
                await self?.lost()
                return nil
            }
        }
        // Signed in on an earlier launch: show who at once, without the
        // network. A refresh token the server no longer takes signs out on the
        // first call.
        if tokens.load() != nil, let user = profile.load() {
            state = .signedIn(user)
        } else {
            profile.clear()
        }
    }

    public func signIn(email: String, password: String) async throws {
        try await accept(try await anonymous.send(Endpoints.authLogin, Login(email: email, password: password)))
    }

    /// Starts an account: a 6-digit code goes to the email, and nothing is
    /// signed in until `confirmEmail` (#702). Calling it again sends a new code.
    @discardableResult
    public func createAccount(email: String, displayName: String, password: String) async throws -> CodeSent {
        let signup = Signup(
            acceptedTosVersion: Constants.tosVersion, displayName: displayName, email: email, password: password)
        return try await anonymous.send(Endpoints.authSignup, signup)
    }

    /// The emailed code signs you in. `agreedToTerms`: the Terms were just
    /// ticked on Create account; from a sign-in they weren't, and the
    /// answer's needsTerms says whether they're out of date.
    public func confirmEmail(email: String, code: String, password: String, agreedToTerms: Bool) async throws {
        let confirm = SignupConfirm(
            acceptedTosVersion: agreedToTerms ? Constants.tosVersion : nil, code: code, email: email, password: password
        )
        try await accept(try await anonymous.send(Endpoints.authSignupConfirm, confirm))
    }

    public func requestPasswordReset(_ request: ResetRequest) async throws {
        _ = try await anonymous.send(Endpoints.authPasswordResetRequest, request)
    }

    /// Sets a new password from the emailed code. True when that also signed
    /// you in: the tokens are kept, and `me` says who you are.
    public func resetPassword(_ confirm: ResetConfirm) async throws -> Bool {
        let done = try await anonymous.send(Endpoints.authPasswordResetConfirm, confirm)
        guard done.signedIn, let idToken = done.idToken, let refreshToken = done.refreshToken else { return false }
        try await session.signedIn(idToken: idToken, refreshToken: refreshToken)
        guard let who = try await client.call(Procedures.me).user else { return false }
        let user = User(id: who.id, email: who.email, displayName: who.displayName, needsTerms: false)
        profile.save(user)
        state = .signedIn(user)
        return true
    }

    /// Signs out here at once, then asks the server to revoke the refresh
    /// token. If that can't reach the server the token is still gone from
    /// this phone.
    /// Signs out because the server said the account is gone; the sign-in
    /// screen shows `message` until the next sign-in.
    public func signOut(because message: String) async {
        await signOut()
        signedOutBecause = message
    }

    public func signOut() async {
        let refreshToken = await session.signOut()
        profile.clear()
        removeDownloadedData()
        state = .signedOut
        if let refreshToken {
            _ = try? await anonymous.send(Endpoints.authLogout, RefreshToken(refreshToken: refreshToken))
        }
    }

    /// Tokens first, so the first call after signing in already has them.
    func accept(_ answer: SignIn) async throws {
        signedOutBecause = nil
        let user = User(
            id: answer.id, email: answer.email, displayName: answer.displayName, needsTerms: answer.needsTerms == true)
        try await session.signedIn(idToken: answer.idToken, refreshToken: answer.refreshToken)
        profile.save(user)
        accountDeleted = false
        state = .signedIn(user)
    }

    /// The server turned the refresh token down.
    private func lost() {
        profile.clear()
        state = .signedOut
    }
}

/// The signed-in person's name and email between launches. Not secret, so
/// UserDefaults; the tokens live in the Keychain.
public struct ProfileStore: Sendable {
    public let key: String
    let defaults: @Sendable () -> UserDefaults

    public init(key: String = "signed-in-user", defaults: @escaping @Sendable () -> UserDefaults = { .standard }) {
        self.key = key
        self.defaults = defaults
    }

    func load() -> AccountModel.User? {
        defaults().data(forKey: key).flatMap { try? JSONDecoder().decode(AccountModel.User.self, from: $0) }
    }

    func save(_ user: AccountModel.User) {
        defaults().set(try? JSONEncoder().encode(user), forKey: key)
    }

    func clear() {
        defaults().removeObject(forKey: key)
    }
}
