import Foundation
import PaddleAPI

/// What the sample server does with a phone's recordings (UI tests).
public enum PhoneUploads: Sendable {
    /// Takes every file (201).
    case accepted
    /// A track with no GPS fix at all (422 no_points).
    case noFix
    /// Never takes one (413 too_large).
    case refused
    /// Down (503): the recordings wait.
    case down
}

/// The phone's routes (C3, mobile/contract/README.md § Phone recording), from
/// the account.phone* fixtures.
extension SampleServer {
    public var phoneUploads: PhoneUploads {
        get { lock.withLock { _phoneUploads } }
        set { lock.withLock { _phoneUploads = newValue } }
    }

    /// The phone was removed on Devices: uploads answer 404 until the app
    /// adds it again after one (the app also asks at sign-in, before it knows).
    public var phoneRemoved: Bool {
        get { lock.withLock { _phoneRemoved } }
        set { lock.withLock { _phoneRemoved = newValue } }
    }

    /// The files the server took, in order.
    public var uploadedRecordings: [String] { lock.withLock { _uploadedRecordings } }

    /// The samples, and a paddle at the top once the phone's track went up,
    /// as the server makes one from it.
    func paddlesList() throws -> Data {
        let data = try fixture("paddles.list")
        guard uploadedRecordings.contains(where: { !$0.hasSuffix("_imu.csv") }) else { return data }
        var list = try JSONDecoder.paddlesnitch.decode(PaddleList.self, from: data)
        if var phone = list.cards.first {
            phone.id = "pdl-phone"
            list.cards.insert(phone, at: 0)
        }
        return try JSONEncoder.paddlesnitch.encode(list)
    }

    func phone(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        if path == "/api/account/devices/phone" {
            lock.withLock { if _phoneRemovedSeen { _phoneRemoved = false } }
            return (201, try fixture("account.phone"))
        }
        if lock.withLock({ _phoneRemoved }) {
            lock.withLock { _phoneRemovedSeen = true }
            return (404, try fixture("account.phone-upload.not-found"))
        }
        if request.httpMethod == "GET" { return (200, Data(#"{"parts":[]}"#.utf8)) }
        let name =
            URLComponents(url: request.url ?? URL(filePath: "/"), resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "filename" }?.value ?? ""
        switch lock.withLock({ _phoneUploads }) {
        case .down:
            return (503, Data("<html>Service unavailable</html>".utf8))
        case .refused:
            return (413, Data(#"{"error":"too_large"}"#.utf8))
        case .noFix where !name.hasSuffix("_imu.csv"):
            return (422, try fixture("account.phone-upload.no-points"))
        case .accepted, .noFix:
            lock.withLock { _uploadedRecordings.append(name) }
            return (
                201, try fixture(name.hasSuffix("_imu.csv") ? "account.phone-upload.motion" : "account.phone-upload")
            )
        }
    }
}
