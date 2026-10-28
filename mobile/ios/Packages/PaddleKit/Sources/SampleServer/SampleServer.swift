import CryptoKit
import Foundation
import PaddleAPI

/// A stand-in for paddlesnitch.com that answers from the contract's golden
/// answers (mobile/contract/fixtures/api). The app's UI tests run against it
/// (launch argument `-SampleServer`), and so do the Account tests: the whole
/// sign-in flow, offline and the same every time.
///
/// Accounts: any email with password `Password123` signs in;
/// `sam@example.com` gets an account that must accept new Terms.
public final class SampleServer: HTTPTransport, @unchecked Sendable {
    public static let password = "Password123"
    public static let needsTermsEmail = "sam@example.com"
    /// Forgot password: this code works; any other is wrong.
    public static let resetCode = "123456"
    public static let wrongResetCodeMessage = "That code is wrong or has expired. Ask for a new one."
    /// An account whose new password is set without signing in.
    public static let resetWithoutSignInEmail = "kim@example.com"

    private let fixtures: URL
    let lock = NSLock()
    var _requests: [URLRequest] = []
    var revoked: Set<String> = []
    var _refusesRefresh = false
    var _termsAccepted = true
    var _failsAccountDelete = false
    var _removedTrackers: Set<String> = []
    var _failsTrackerRemoval = false
    var _failsTrackerList = false
    var _failsTrackerRecordings = false
    var _signInIsRecent = true
    var _profilePublic = true
    var _handle: String? = "river-pat"
    var _contact: String?
    var _placeholderEmail = false
    var _stravaConnected = false
    var _stravaAutoImport = true
    var _stravaNotConfigured = false
    var _options: SignInOptions? = SignInOptions(google: true, strava: true)
    var _optionsLater: SignInOptions?
    var _stravaLinkedElsewhere = false
    var _failsStrava = false
    /// Signed in through Strava: the sign-in email is a placeholder.
    public var placeholderEmail: Bool {
        get { lock.withLock { _placeholderEmail } }
        set { lock.withLock { _placeholderEmail = newValue } }
    }
    var _failsProfileChange = false
    /// Make public/private fail, as when the server is down.
    public var failsProfileChange: Bool {
        get { lock.withLock { _failsProfileChange } }
        set { lock.withLock { _failsProfileChange = newValue } }
    }
    /// A handle someone else has.
    public static let takenHandle = "taken-handle"
    public static let badEmailMessage = "That doesn't look like an email address."
    var _waitingForCode: [String: String] = [:]
    var _unconfirmed: Set<String> = [SampleServer.unconfirmedEmail, SampleServer.unconfirmedOldTermsEmail]
    var _tooManyCodes = false
    var _confirmSignInFails = false
    /// Make the last sign-in older than 10 minutes, as after a day signed
    /// in: `GET /api/account` says so and `DELETE` refuses (403 reauth).
    /// A sign-in makes it recent again.
    public var signInIsRecent: Bool {
        get { lock.withLock { _signInIsRecent } }
        set { lock.withLock { _signInIsRecent = newValue } }
    }
    /// Make `DELETE /api/account` fail, as when the server is down.
    public var failsAccountDelete: Bool {
        get { lock.withLock { _failsAccountDelete } }
        set { lock.withLock { _failsAccountDelete = newValue } }
    }
    /// Where the sample export's link points: served here, as the real link
    /// is served by the bucket.
    public static let exportPath = "/sample-exports/paddlesnitch-data.json"
    /// Make the refresh route turn every token down, as after a password reset.
    public var refusesRefresh: Bool {
        get { lock.withLock { _refusesRefresh } }
        set { lock.withLock { _refusesRefresh = newValue } }
    }

    private let summariesPending: Bool
    private var written: Set<String> = []

    /// `summariesPending`: answer every paddle as saved before its summary
    /// was written (`insightPending`), until `paddles.writeSummary` writes it.
    public init(fixtures: URL, summariesPending: Bool = false) {
        self.fixtures = fixtures
        self.summariesPending = summariesPending
    }

    public var requests: [URLRequest] { lock.withLock { _requests } }
    public var revokedTokens: Set<String> { lock.withLock { revoked } }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { _requests.append(request) }
        let (status, body) = try answer(request)
        guard let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"])
        else { throw URLError(.badURL) }
        return (body, response)
    }

    private func answer(_ request: URLRequest) throws -> (Int, Data) {
        let path = request.url?.path ?? ""
        if path.hasPrefix("/att/api/auth/signup") {
            return try signup(path: path, body: request.httpBody ?? Data())
        }
        if path.hasPrefix("/att/api/auth/password-reset/") {
            return try passwordReset(path: path, body: request.httpBody ?? Data())
        }
        if Self.googleRoutes.contains(path) {
            return try google(path: path, request: request)
        }
        if path.hasPrefix("/att/api/auth/") {
            return try auth(path: path, body: request.httpBody ?? Data())
        }
        if path.hasPrefix("/api/trpc/") {
            return try trpc(path: path, request: request)
        }
        if path == "/paddles/api/analyse" {
            return analyse(request)
        }
        if path == "/api/account" || path.hasPrefix("/api/account/") {
            return try accountRoutes(path: path, request: request)
        }
        if path.hasPrefix("/att/api/strava/") {
            return try strava(path: path, request: request)
        }
        if path == Self.exportPath {
            return (200, Data(#"{"account":{"email":"pat@example.com"},"paddles":[]}"#.utf8))
        }
        return (404, Data(#"{"error":"Not found"}"#.utf8))
    }

    /// The sign-in routes (mobile/contract/api/rest.json).
    private func auth(path: String, body: Data) throws -> (Int, Data) {
        switch path {
        case "/att/api/auth/login":
            let login = try JSONDecoder().decode(Login.self, from: body)
            guard login.password == Self.password else { return (401, try fixture("auth.error")) }
            if lock.withLock({ _tooManyCodes }) { return (429, try fixture("auth.too-many-codes")) }
            if lock.withLock({ _unconfirmed.contains(login.email) }) {
                lock.withLock { _waitingForCode[login.email] = login.password }
                return (403, try fixture("auth.login.needs-code"))
            }
            lock.withLock {
                _termsAccepted = login.email != Self.needsTermsEmail
                _placeholderEmail = false
                _signInIsRecent = true
            }
            return (200, try signIn(login.email == Self.needsTermsEmail ? "auth.login.needs-terms" : "auth.login"))
        case "/att/api/auth/strava/app-token":
            // A code from `stravaBrowser` carries its challenge, so this checks
            // the verifier the way the server does.
            let swap = try JSONDecoder().decode(StravaAppToken.self, from: body)
            guard swap.code == "sample." + Self.challenge(swap.verifier) else {
                return (401, Data(#"{"error":"That sign-in has expired. Please try again."}"#.utf8))
            }
            lock.withLock {
                _placeholderEmail = true
                // A Strava sign-in is a real one: recent, as the server counts it.
                _signInIsRecent = true
            }
            return (200, try signIn("auth.login"))
        case "/att/api/auth/refresh":
            let token = try JSONDecoder().decode(RefreshToken.self, from: body).refreshToken
            let refused = lock.withLock { _refusesRefresh || revoked.contains(token) }
            return refused ? (401, try fixture("auth.error")) : (200, try fixture("auth.refresh"))
        case "/att/api/auth/logout":
            let token = try JSONDecoder().decode(RefreshToken.self, from: body).refreshToken
            _ = lock.withLock { revoked.insert(token) }
            return (200, Data(#"{"ok":true}"#.utf8))
        default:
            return (404, Data(#"{"error":"Not found"}"#.utf8))
        }
    }

    /// The tRPC procedures (mobile/contract/api/procedures.json).
    private func trpc(path: String, request: URLRequest) throws -> (Int, Data) {
        let signedIn = request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true
        switch path {
        case "/api/trpc/me":
            return (200, trpc(try fixture(signedIn ? "me.signed-in" : "me.signed-out")))
        case "/api/trpc/paddles.list":
            return signedIn ? (200, trpc(try fixture("paddles.list"))) : Self.unauthorized
        case "/api/trpc/paddles.get":
            guard signedIn else { return Self.unauthorized }
            let id = try input(ById.self, from: request).id
            let pending = summariesPending && lock.withLock { !written.contains(id) }
            return try paddle(id: id, pending: pending)
        case "/api/trpc/paddles.writeSummary":
            guard signedIn else { return Self.unauthorized }
            let id = try JSONDecoder().decode(ById.self, from: request.httpBody ?? Data()).id
            lock.withLock { _ = written.insert(id) }
            let summary = try fixture("paddles.writeSummary")
            let paddle = try JSONDecoder.paddlesnitch.decode(AnalysisSession.self, from: summary)
            return paddle.id == id ? (200, trpc(summary)) : try self.paddle(id: id, pending: false)
        default:
            return (404, Data(#"{"error":{"message":"Not found","data":{"code":"NOT_FOUND","httpStatus":404}}}"#.utf8))
        }
    }

    /// The first `paddles.get*.json` with this id, `paddles.get.json` first.
    private func paddle(id: String, pending: Bool) throws -> (Int, Data) {
        let names = try FileManager.default.contentsOfDirectory(atPath: fixtures.path)
            .filter { $0.hasPrefix("paddles.get") && $0.hasSuffix(".json") }.sorted()
        for name in names {
            let data = try Data(contentsOf: fixtures.appending(path: name))
            guard var paddle = try? JSONDecoder.paddlesnitch.decode(AnalysisSession.self, from: data), paddle.id == id
            else { continue }
            guard pending else { return (200, trpc(data)) }
            paddle.insightPending = true
            return (200, trpc(try JSONEncoder.paddlesnitch.encode(paddle)))
        }
        return (404, Data(#"{"error":{"message":"Not found","data":{"code":"NOT_FOUND","httpStatus":404}}}"#.utf8))
    }

    /// Adding a paddle from a file. The file's name picks the answer: one with
    /// "duplicate" in it was already there, "unreadable" can't be read, "huge"
    /// is over the limit; any other is added as `pdl-river`, a sample that
    /// can be opened.
    private func analyse(_ request: URLRequest) -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, Data(#"{"error":"Sign in to analyse and save paddles."}"#.utf8))
        }
        let body = String(bytes: request.httpBody ?? Data(), encoding: .utf8) ?? ""
        let name =
            body.components(separatedBy: "filename=\"").dropFirst().first?
            .components(separatedBy: "\"").first ?? ""
        if name.contains("huge") { return (413, Data("Request Entity Too Large".utf8)) }
        if name.contains("unreadable") {
            return (422, Data(#"{"error":"That file has too few GPS points to analyse."}"#.utf8))
        }
        if name.contains("duplicate") { return (200, Data(#"{"id":"pdl-river","duplicate":true}"#.utf8)) }
        return (200, Data(#"{"id":"pdl-river"}"#.utf8))
    }

    /// Strava sign-in without Strava: answers the start page's link at once
    /// with a code the app-token route takes for that challenge.
    public static func stravaBrowser(_ start: URL) -> URL {
        let challenge =
            URLComponents(url: start, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "challenge" }?.value ?? ""
        return URL(string: "com.paddlesnitch.app:/signin/strava?code=sample.\(challenge)") ?? start
    }

    static func challenge(_ verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static let unauthorized = (
        401, Data(#"{"error":{"message":"Sign in","data":{"code":"UNAUTHORIZED","httpStatus":401}}}"#.utf8)
    )

    /// A sign-in answer with a refresh token of its own, as the server
    /// gives: one revoked by signing out mustn't come back on the next.
    func signIn(_ name: String) throws -> Data {
        var answer = try JSONDecoder.paddlesnitch.decode(SignIn.self, from: try fixture(name))
        // Random, not counted: a relaunched app starts a new sample server.
        answer.refreshToken += "." + UUID().uuidString
        return try JSONEncoder.paddlesnitch.encode(answer)
    }

    func fixture(_ name: String) throws -> Data {
        try Data(contentsOf: fixtures.appending(path: "\(name).json"))
    }

    private func trpc(_ data: Data) -> Data {
        Data(#"{"result":{"data":"#.utf8) + data + Data("}}".utf8)
    }

    private func input<T: Decodable>(_ type: T.Type, from request: URLRequest) throws -> T {
        let query = URLComponents(url: request.url ?? URL(filePath: "/"), resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "input" }?.value
        return try JSONDecoder().decode(T.self, from: Data((query ?? "").utf8))
    }
}
