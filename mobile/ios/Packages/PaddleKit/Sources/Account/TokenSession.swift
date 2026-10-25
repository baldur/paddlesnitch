import Foundation
import PaddleAPI

/// Hands out a valid ID token: the one in memory while it has a minute left,
/// else a fresh one from the refresh token. Several calls arriving while a
/// refresh is under way share it rather than each spending the refresh token.
public actor TokenSession {
    public enum Outcome: Equatable, Sendable {
        case token(String)
        /// No refresh token, or the server turned it down: sign in again.
        case signedOut
    }

    private let store: any TokenStore
    private let refresher: @Sendable (String) async throws -> String
    private let now: @Sendable () -> Date
    private var idToken: String?
    private var refreshing: Task<Outcome, any Error>?

    /// `refresher` swaps a refresh token for an ID token (the refresh route),
    /// throwing `PaddleAPIError.rejected` with status 401 when it's no good.
    public init(
        store: any TokenStore, now: @escaping @Sendable () -> Date = Date.init,
        refresher: @escaping @Sendable (String) async throws -> String
    ) {
        self.store = store
        self.now = now
        self.refresher = refresher
    }

    public var hasAccount: Bool { store.load() != nil }

    /// After signing in: keep both tokens.
    public func signedIn(idToken: String, refreshToken: String) throws {
        try store.save(refreshToken)
        self.idToken = idToken
    }

    /// The refresh token, kept: deleting the account sends it to be revoked
    /// and forgets it only once that's done.
    public var refreshToken: String? { store.load() }

    /// The refresh token to revoke on signing out, then forget everything.
    public func signOut() -> String? {
        let refreshToken = store.load()
        idToken = nil
        refreshing?.cancel()
        refreshing = nil
        store.clear()
        return refreshToken
    }

    /// A token to send. `refresh` forces a new one: the server turned the
    /// last one down.
    public func token(refresh: Bool = false) async throws -> Outcome {
        if !refresh, let idToken, !JWT.expires(idToken, within: 60, now: now()) {
            return .token(idToken)
        }
        if let refreshing { return try await refreshing.value }
        guard let refreshToken = store.load() else { return .signedOut }
        // Runs on this actor, so it settles the state for every caller that
        // waits on it, not just this one.
        let task = Task { () async throws -> Outcome in
            do {
                let fresh = try await refresher(refreshToken)
                // Signed out while the refresh was under way: keep nothing.
                if Task.isCancelled { return .signedOut }
                idToken = fresh
                return .token(fresh)
            } catch PaddleAPIError.rejected(_, 401, _) {
                idToken = nil
                store.clear()
                return .signedOut
            }
        }
        refreshing = task
        defer { if refreshing == task { refreshing = nil } }
        return try await task.value
    }
}

/// Just enough of a JWT to read when it expires. The server checks the
/// signature; the app only needs to know when to fetch a new one.
enum JWT {
    static func expiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let exp = payload["exp"] as? Double
        else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    /// True if it expires within `seconds`, or its expiry can't be read.
    static func expires(_ token: String, within seconds: TimeInterval, now: Date) -> Bool {
        guard let expiry = expiry(token) else { return true }
        return expiry.timeIntervalSince(now) < seconds
    }
}
