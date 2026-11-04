import CryptoKit
import Foundation
import PaddleAPI

/// Boat motion (mobile/contract/README.md, "Boat motion"): a recording's
/// motion, from the account.devices-session fixtures.
extension SampleServer {
    /// How `GET /api/account/devices/sessions/<id>` answers.
    public enum MotionAnswer: Sendable {
        /// S0012 (pdl-river) measured, any other no motion file yet.
        case fixtures
        /// The file arrived and couldn't be measured.
        case unusable
        case notFound
        /// Fails every time, as when the server is down.
        case fails
        /// Fails once, then answers from the fixtures.
        case failsOnce
    }

    public var motionAnswer: MotionAnswer {
        get { lock.withLock { _motionAnswer } }
        set { lock.withLock { _motionAnswer = newValue } }
    }

    static func isMotion(_ path: String) -> Bool {
        path.hasPrefix("/api/account/devices/sessions/")
    }

    func motion(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        let answer = lock.withLock {
            let answer = _motionAnswer
            if answer == .failsOnce { _motionAnswer = .fixtures }
            return answer
        }
        switch answer {
        case .fails, .failsOnce: return (502, Data("<html>Bad gateway</html>".utf8))
        case .notFound: return (404, try fixture("account.devices-session.not-found"))
        case .unusable: return (200, try fixture("account.devices-session.motion-unusable"))
        case .fixtures:
            let measured = path.hasSuffix("/S0012")
            return (200, try fixture(measured ? "account.devices-session" : "account.devices-session.no-motion"))
        }
    }

    /// The server's ETag for a motion answer, and its 304 when the app
    /// already has it: the headers to add.
    static func conditional(_ request: URLRequest, status: inout Int, body: inout Data) -> [String: String] {
        guard status == 200 else { return [:] }
        let tag = "\"" + SHA256.hash(data: body).prefix(8).map { String(format: "%02x", $0) }.joined() + "\""
        if request.value(forHTTPHeaderField: "If-None-Match") == tag {
            status = 304
            body = Data()
        }
        return ["ETag": tag]
    }
}
