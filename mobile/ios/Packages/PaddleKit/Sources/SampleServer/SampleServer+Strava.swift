import Foundation
import PaddleAPI

/// Strava for a signed-in account (mobile/contract/README.md, "Strava,
/// signed in"), played without Strava: connected or not, and auto-import.
extension SampleServer {
    /// Make connecting answer 503, as when the server has no Strava keys.
    public var stravaNotConfigured: Bool {
        get { lock.withLock { _stravaNotConfigured } }
        set { lock.withLock { _stravaNotConfigured = newValue } }
    }

    /// Already connected, as an account that connected on the website.
    public var stravaConnected: Bool {
        get { lock.withLock { _stravaConnected } }
        set { lock.withLock { _stravaConnected = newValue } }
    }

    func strava(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        let body = request.httpBody ?? Data()
        switch path {
        case "/att/api/strava/app-connect":
            return try connect(body)
        case "/att/api/strava/app-connect/finish":
            // A code from `stravaConnectBrowser` carries its challenge, so
            // this checks the verifier the way the server does.
            let finish = try JSONDecoder().decode(StravaConnectFinish.self, from: body)
            guard finish.code == "sample." + Self.challenge(finish.verifier) else {
                return (400, Data(#"{"error":"That didn’t work. Please start again."}"#.utf8))
            }
            lock.withLock {
                _stravaConnected = true
                _stravaAutoImport = true
            }
        case "/att/api/strava/auto-import":
            let set = try JSONDecoder().decode(StravaAutoImportSet.self, from: body)
            lock.withLock { _stravaAutoImport = set.enabled }
            return (200, try JSONEncoder.paddlesnitch.encode(StravaAutoImport(autoImport: set.enabled)))
        case "/att/api/strava/disconnect":
            lock.withLock { _stravaConnected = false }
            return (200, Data(#"{"ok":true}"#.utf8))
        default:
            break
        }
        return (200, try JSONEncoder.paddlesnitch.encode(stravaStatus))
    }

    private var stravaStatus: StravaStatus {
        lock.withLock {
            guard _stravaConnected else { return StravaStatus(connected: false) }
            return StravaStatus(
                athlete: .init(id: 12_345_678, name: "Pat Paddler"), autoImport: _stravaAutoImport, connected: true)
        }
    }

    private func connect(_ body: Data) throws -> (Int, Data) {
        if stravaNotConfigured {
            return (503, Data(#"{"error":"Strava isn’t set up on this server."}"#.utf8))
        }
        guard signInIsRecent else {
            let words = "For your safety, connecting Strava needs a recent sign-in. Please sign in again."
            return (403, Data(#"{"error":"\#(words)","reauth":true}"#.utf8))
        }
        let challenge = try JSONDecoder().decode(StravaConnectStart.self, from: body).challenge
        var page = URLComponents(string: "https://www.strava.com/oauth/authorize")
        page?.queryItems = [URLQueryItem(name: "state", value: challenge)]
        return (200, try JSONEncoder.paddlesnitch.encode(WebPage(url: page?.url?.absoluteString ?? "")))
    }

    /// Strava's consent page without Strava: says yes at once, with a code
    /// the finish route takes for that challenge.
    public static func stravaConnectBrowser(_ page: URL) -> URL {
        let challenge =
            URLComponents(url: page, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "state" }?.value ?? ""
        return URL(string: "com.paddlesnitch.app:/account/strava?code=sample.\(challenge)") ?? page
    }
}
