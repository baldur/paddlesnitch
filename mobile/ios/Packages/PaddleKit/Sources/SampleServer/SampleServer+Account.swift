import Foundation
import PaddleAPI

/// The account routes, played for the UI tests (mobile/contract/README.md,
/// "Account").
extension SampleServer {
    /// Everything under /api/account: the profile, the trackers, the rest.
    func accountRoutes(path: String, request: URLRequest) throws -> (Int, Data) {
        if ["/api/account/profile", "/api/account/handle", "/api/account/contact"].contains(path) {
            return try profile(path: path, request: request)
        }
        if path.hasPrefix("/api/account/devices") {
            return try trackers(path: path, request: request)
        }
        return try account(path: path, request: request)
    }

    /// The account routes (mobile/contract/README.md, "Account"), from the
    /// account.* fixtures.
    func account(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        switch (request.httpMethod ?? "GET", path) {
        case ("GET", "/api/account/tos"):
            guard lock.withLock({ _termsAccepted }) else { return (200, try fixture("account.tos")) }
            let accepted = TosStatus(
                acceptances: [
                    TosAcceptance(acceptedAt: Date(timeIntervalSince1970: 1_788_000_000), version: Constants.tosVersion)
                ],
                accepted: true, currentVersion: Constants.tosVersion)
            return (200, try JSONEncoder.paddlesnitch.encode(accepted))
        case ("POST", "/api/account/tos"):
            let accept = try JSONDecoder().decode(TosAccept.self, from: request.httpBody ?? Data())
            guard accept.version == Constants.tosVersion else {
                return (
                    422, Data(#"{"error":"The Terms of Service have changed. Update the app to accept them."}"#.utf8)
                )
            }
            lock.withLock { _termsAccepted = true }
            return (200, try fixture("account.tos-accepted"))
        case ("GET", "/api/account"):
            return (200, Data(#"{"recentSignIn":\#(lock.withLock { _signInIsRecent })}"#.utf8))
        case ("POST", "/api/account/export"):
            return (200, Data(#"{"url":"\#(Self.exportPath)"}"#.utf8))
        case ("DELETE", "/api/account"):
            return try deleteAccount(request)
        default:
            return (404, Data(#"{"error":"Not found"}"#.utf8))
        }
    }

    /// Public or private, the handle and the contact email, kept here.
    func profile(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        let body = request.httpBody ?? Data()
        switch (request.httpMethod ?? "GET", path) {
        case ("PATCH", "/api/account/profile") where failsProfileChange:
            return (502, Data("<html>Bad gateway</html>".utf8))
        case ("PATCH", "/api/account/profile"):
            let visibility = try JSONDecoder().decode(ProfileVisibility.self, from: body)
            lock.withLock { _profilePublic = visibility.public }
        case ("PUT", "/api/account/handle"):
            let claim = try JSONDecoder().decode(HandleClaim.self, from: body)
            guard claim.handle != Self.takenHandle else {
                return (400, Data(#"{"error":"That handle is already taken."}"#.utf8))
            }
            lock.withLock { _handle = claim.handle }
        case ("DELETE", "/api/account/handle"):
            lock.withLock { _handle = nil }
        case ("GET", "/api/account/contact"), ("POST", "/api/account/contact"), ("DELETE", "/api/account/contact"):
            return try contact(method: request.httpMethod ?? "GET", body: body)
        default:
            break
        }
        let settings = lock.withLock { ProfileSettings(handle: _handle, public: _profilePublic) }
        return (200, try JSONEncoder.paddlesnitch.encode(settings))
    }

    func contact(method: String, body: Data) throws -> (Int, Data) {
        switch method {
        case "POST":
            let email = try JSONDecoder().decode(ContactEmail.self, from: body).email
            guard email.contains("@") else { return (400, Data(#"{"error":"\#(Self.badEmailMessage)"}"#.utf8)) }
            lock.withLock { _contact = email }
        case "DELETE":
            lock.withLock { _contact = nil }
            return (200, Data(#"{"ok":true}"#.utf8))
        default:
            break
        }
        let (email, placeholder) = lock.withLock { (_contact, _placeholderEmail) }
        let answer = Contact(
            contact: email.map { Contact.Contact(addedAt: Date(), email: $0) }, placeholderEmail: placeholder)
        return (200, try JSONEncoder.paddlesnitch.encode(answer))
    }

    /// Deleting: refused without a recent sign-in, as the server does.
    func deleteAccount(_ request: URLRequest) throws -> (Int, Data) {
        if lock.withLock({ _failsAccountDelete }) {
            return (500, Data(#"{"error":"Couldn't delete the account."}"#.utf8))
        }
        guard lock.withLock({ _signInIsRecent }) else {
            let words = "For your safety, deleting your account needs a recent sign-in. Please sign in again."
            return (403, Data(#"{"error":"\#(words)","reauth":true}"#.utf8))
        }
        let body = try JSONDecoder().decode(DeleteAccount.self, from: request.httpBody ?? Data())
        if let token = body.refreshToken { _ = lock.withLock { revoked.insert(token) } }
        return (200, Data(#"{"ok":true}"#.utf8))
    }
}
