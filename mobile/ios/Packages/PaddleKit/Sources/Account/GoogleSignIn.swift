import Foundation
import PaddleAPI

/// Google sign-in (mobile/contract/README.md, Signing in → "Google"): in the
/// system's sign-in browser with a PKCE verifier. The page
/// first asks for one tap on "Sign in with Google", so a link alone can't
/// finish a sign-in for the app. It ends on
/// com.paddlesnitch.app:/signin/google with a one-time code.
public enum GoogleSignIn {
    /// The app's own scheme, which the sign-in page ends on.
    public static let callbackScheme = "com.paddlesnitch.app"

    public static func startURL(baseURL: URL, challenge: String) -> URL {
        baseURL.appending(path: "att/api/auth/google/init")
            .appending(queryItems: [URLQueryItem(name: "challenge", value: challenge)])
    }

    /// The code the sign-in came back with, or why there isn't one.
    public static func code(from callback: URL) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let key = items.first(where: { $0.name == "error" })?.value { throw GoogleSignInError(key: key) }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            throw GoogleSignInError(key: "")
        }
        return code
    }
}

/// The sign-in came back with `?error=<key>`, or without a code.
public struct GoogleSignInError: Error, Equatable {
    public let key: String

    /// The website's /signin words for the same keys.
    public var message: String {
        switch key {
        case "google_account_exists": "You already have an account with this email. Sign in with your email instead."
        case "google_no_email":
            "Couldn’t sign in with Google, because Google didn’t share a confirmed email address. "
                + "Please sign up with your email instead."
        case "google_denied": "You cancelled the Google sign-in."
        case "google_not_configured": "Google sign-in isn’t available right now."
        default: "Couldn’t sign in with Google. Please try again."
        }
    }
}

/// `strava` is still decoded for older builds, but always ignored: Strava has
/// gone from paddlesnitch, and the server always sends false.
extension SignInOptions {
    public static let emailOnly = SignInOptions(google: false, strava: false)
}

/// Help for someone who made their account with Strava, which has gone: an
/// email, not a public issue report, as they'd put their name and email in it.
public enum SignInHelp {
    /// Under the sign-in form, always.
    public static let madeWithStrava = "Made your account with Strava? Email us and we’ll move it to your email."
    public static let emailUs =
        URL(string: "mailto:privacy@paddlesnitch.com?subject=Move%20my%20account%20to%20my%20email")
        ?? URL(filePath: "/")
}

extension AccountModel {
    /// Asks which ways in the server offers (Google). The sign-in screen
    /// asks when it opens.
    public func loadOptions() async {
        // A failed ask keeps the last answer: only a first ask that fails
        // leaves email only, and says so.
        guard let answer = try? await anonymous.send(Endpoints.getAuthOptions, NoInput()) else {
            optionsFailed = options == .emailOnly
            return
        }
        options = answer
        optionsFailed = false
    }

    /// Google sign-in. `browser` opens the page and answers the link it came
    /// back on. The verifier never leaves this call.
    public func signInWithGoogle(browser: (URL) async throws -> URL) async throws {
        let verifier = Pkce.verifier()
        let start = GoogleSignIn.startURL(baseURL: anonymous.baseURL, challenge: Pkce.challenge(verifier))
        let code = try GoogleSignIn.code(from: try await browser(start))
        try await accept(
            try await anonymous.send(Endpoints.authGoogleAppToken, GoogleAppToken(code: code, verifier: verifier)))
    }

    /// The website's issue form, signed in as this account through a
    /// one-time web-code link, so the report is filed as it (a recording the
    /// server won't take).
    public func reportPage() async throws -> URL {
        let page = try await client.send(Endpoints.authWebCode, WebPageFor(next: "/account?report=1"))
        guard let url = Self.resolve(page.url, against: client.baseURL) else {
            throw PaddleAPIError.undecodable("web-code link")
        }
        return url
    }
}
