import Foundation
import PaddleAPI

/// Google sign-in (mobile/contract/README.md, Signing in → "Google"): as
/// Strava's, in the system's sign-in browser with a PKCE verifier. The page
/// first asks for one tap on "Sign in with Google", so a link alone can't
/// finish a sign-in for the app. It ends on
/// com.paddlesnitch.app:/signin/google with a one-time code.
public enum GoogleSignIn {
    public static func startURL(baseURL: URL, challenge: String) -> URL {
        baseURL.appending(path: "att/api/auth/google/init")
            .appending(queryItems: [URLQueryItem(name: "challenge", value: challenge)])
    }

    /// The code the sign-in came back with, or why there isn't one.
    /// `stravaOn`: whether to mention Strava as another way in.
    public static func code(from callback: URL, stravaOn: Bool) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let key = items.first(where: { $0.name == "error" })?.value {
            throw GoogleSignInError(key: key, stravaOn: stravaOn)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            throw GoogleSignInError(key: "", stravaOn: stravaOn)
        }
        return code
    }
}

/// The sign-in came back with `?error=<key>`, or without a code.
public struct GoogleSignInError: Error, Equatable {
    public let key: String
    public let stravaOn: Bool

    /// The website's /signin words for the same keys.
    public var message: String {
        switch key {
        case "google_account_exists":
            stravaOn
                ? "You already have an account with this email. Sign in with your email or Strava instead."
                : "You already have an account with this email. Sign in with your email instead."
        case "google_no_email":
            "Couldn’t sign in with Google, because Google didn’t share a confirmed email address. "
                + "Please sign up with your email instead."
        case "google_denied": "You cancelled the Google sign-in."
        case "google_not_configured": "Google sign-in isn’t available right now."
        default: "Couldn’t sign in with Google. Please try again."
        }
    }
}

extension SignInOptions {
    public static let emailOnly = SignInOptions(google: false, strava: false)

    /// The empty Paddles list: Strava is a way to add one only when it's on.
    public var noPaddlesYet: String {
        strava
            ? "Add one from a GPS file, Strava or a time trial. A tracker adds its own."
            : "Add one from a GPS file or a time trial. A tracker adds its own."
    }
}

/// The website's issue form, which opens by itself on a page with
/// `?report=1`: for whoever can't sign in, so it needs no account and
/// carries nothing about them.
public enum ReportIssue {
    public static func url(base: URL) -> URL {
        base.appending(path: "signin").appending(queryItems: [URLQueryItem(name: "report", value: "1")])
    }
}

extension AccountModel {
    /// Asks which ways in the server offers. Every screen that shows Google
    /// or Strava asks when it opens: sign in, Account, Add paddle.
    public func loadOptions() async {
        // A failed ask keeps the last answer: only a first ask that fails
        // leaves email only.
        guard let answer = try? await anonymous.send(Endpoints.getAuthOptions, NoInput()) else { return }
        options = answer
        stravaSaidOff = !answer.strava
    }

    /// Google sign-in. `browser` opens the page and answers the link it came
    /// back on. The verifier never leaves this call.
    public func signInWithGoogle(browser: (URL) async throws -> URL) async throws {
        let verifier = Pkce.verifier()
        let start = GoogleSignIn.startURL(baseURL: anonymous.baseURL, challenge: Pkce.challenge(verifier))
        let code = try GoogleSignIn.code(from: try await browser(start), stravaOn: options.strava)
        try await accept(
            try await anonymous.send(Endpoints.authGoogleAppToken, GoogleAppToken(code: code, verifier: verifier)))
    }
}
