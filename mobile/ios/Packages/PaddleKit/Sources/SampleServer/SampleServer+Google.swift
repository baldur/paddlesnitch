import Foundation
import PaddleAPI

/// Google sign-in and the sign-in options (mobile/contract/README.md,
/// Signing in → "Google"), played without Google.
extension SampleServer {
    /// What `GET /att/api/auth/options` answers; nil makes it fail.
    public var options: SignInOptions? {
        get { lock.withLock { _options } }
        set { lock.withLock { _options = newValue } }
    }

    static let googleRoutes: Set<String> = [
        "/att/api/auth/options", "/att/api/auth/google/app-token", "/att/api/auth/web-code",
    ]

    func google(path: String, request: URLRequest) throws -> (Int, Data) {
        if path == "/att/api/auth/web-code" { return try webCode(request) }
        let body = request.httpBody ?? Data()
        if path == "/att/api/auth/options" {
            let options = lock.withLock { _options }
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

    /// A one-time link that signs the website in as the app's person, then
    /// opens `next` (mobile/contract/README.md, "Website pages, signed in").
    func webCode(_ request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        let next = try JSONDecoder().decode(WebPageFor.self, from: request.httpBody ?? Data()).next
        var link = URLComponents(string: Self.webCodePath)
        link?.queryItems = [URLQueryItem(name: "next", value: next)]
        return (200, try JSONEncoder.paddlesnitch.encode(WebPage(url: link?.string ?? Self.webCodePath)))
    }

    /// Where the sample web-code link points, relative to the site.
    public static let webCodePath = "/att/api/auth/web-code/sample"
}
