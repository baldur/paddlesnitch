import CryptoKit
import Foundation

/// Strava sign-in (mobile/contract/README.md, "Strava"): the website's flow in
/// the system's sign-in browser, ending on com.paddlesnitch.app:/signin/strava
/// with a one-time code that only the verifier kept here can swap for tokens.
public enum StravaSignIn {
    public static let callbackScheme = "com.paddlesnitch.app"

    /// The page to open for this challenge.
    public static func startURL(baseURL: URL, challenge: String) -> URL {
        baseURL.appending(path: "att/api/auth/strava/init")
            .appending(queryItems: [URLQueryItem(name: "challenge", value: challenge)])
    }

    /// The code the sign-in came back with, or why there isn't one.
    public static func code(from callback: URL) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let key = items.first(where: { $0.name == "error" })?.value { throw StravaSignInError(key: key) }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            throw StravaSignInError(key: "")
        }
        return code
    }
}

/// The sign-in came back with `?error=<key>`, or without a code.
public struct StravaSignInError: Error, Equatable {
    public let key: String

    /// The website's /signin words for the same keys.
    public var message: String {
        switch key {
        case "strava_denied": "You cancelled the Strava sign-in."
        case "strava_profile_failed": "Couldn’t load your Strava profile. Please try again."
        case "strava_user_create_failed":
            "Couldn’t create an account from your Strava profile. Please sign up with your email instead."
        case "strava_not_configured": "Strava sign-in isn’t available right now."
        default: "Strava sign-in didn’t finish. Please try again."
        }
    }
}

/// RFC 7636 S256.
public enum Pkce {
    /// 32 random bytes, base64url. `UInt8.random` uses the system's
    /// cryptographic generator.
    public static func verifier() -> String {
        base64URL(Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }))
    }

    public static func challenge(_ verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
