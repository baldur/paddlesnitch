import Foundation
import PaddleAPI

/// Google sign-in and the sign-in options (mobile/contract/README.md,
/// Signing in → "Google", "When strava is false"), played without Google.
extension SampleServer {
    /// What `GET /att/api/auth/options` answers; nil makes it fail.
    public var options: SignInOptions? {
        get { lock.withLock { _options } }
        set { lock.withLock { _options = newValue } }
    }

    func google(path: String, body: Data) throws -> (Int, Data) {
        if path == "/att/api/auth/options" {
            guard let options else { return (500, Data(#"{"error":"Something went wrong."}"#.utf8)) }
            return (200, try JSONEncoder.paddlesnitch.encode(options))
        }
        // A code from `googleBrowser` carries its challenge, so this checks
        // the verifier the way the server does.
        let swap = try JSONDecoder().decode(GoogleAppToken.self, from: body)
        guard swap.code == "sample-google." + Self.challenge(swap.verifier) else {
            return (401, Data(#"{"error":"That sign-in has expired. Please try again."}"#.utf8))
        }
        lock.withLock { _signInIsRecent = true }
        return (200, try signIn("auth.login"))
    }

    /// Google sign-in without Google: answers the start page's link at once
    /// with a code the app-token route takes for that challenge.
    public static func googleBrowser(_ start: URL) -> URL {
        let challenge =
            URLComponents(url: start, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "challenge" }?.value ?? ""
        return URL(string: "com.paddlesnitch.app:/signin/google?code=sample-google.\(challenge)") ?? start
    }
}
