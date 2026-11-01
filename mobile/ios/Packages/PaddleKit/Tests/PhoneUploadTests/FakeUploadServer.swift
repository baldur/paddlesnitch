import CryptoKit
import Foundation
import PaddleAPI

let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // PhoneUploadTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // PaddleKit
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile
    .appending(path: "contract/fixtures/api")

func fixture(_ name: String) -> Data {
    guard let data = try? Data(contentsOf: fixtures.appending(path: "\(name).json")) else {
        fatalError("no fixture \(name)")
    }
    return data
}

/// The phone routes as the server answers them (session-upload.ts): pieces
/// held until the last one puts the file together, its sha256 checked; the
/// answers from the contract's `account.phone*` fixtures. Tests script the
/// rest (`answers`).
final class FakeUploadServer: HTTPTransport, @unchecked Sendable {
    struct Call: Equatable {
        let method: String
        let path: String
        let query: [String: String]
        let body: Data
        let contentType: String?
        let authorization: String?
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    /// Files put together, by name.
    private var _files: [String: Data] = [:]
    private var pieces: [String: [Int: Data]] = [:]
    /// What the next uploads of a file get instead, in turn (status, fixture
    /// or body). Shared across files when keyed "*".
    var answers: [String: [(Int, Data)]] = [:]
    /// Pieces the server "loses" on the way: they answer 202 and aren't kept.
    var lose: Set<Int> = []
    /// Pieces held from an earlier upload that broke off.
    var held: [String: [Int: Data]] = [:]
    var phoneAnswer: (Int, Data) = (201, fixture("account.phone"))
    /// What the held-pieces GET answers instead, if set.
    var heldAnswer: (Int, Data)?
    /// Requests with this token get 401, as an expired one does.
    var refusesToken: String?
    /// The next this many requests fail as the network does.
    var networkFailures = 0
    var phoneRemoved = false

    var calls: [Call] { lock.withLock { _calls } }
    var files: [String: Data] { lock.withLock { _files } }
    var uploads: [Call] { calls.filter { $0.method == "POST" && $0.path.hasSuffix("/sessions") } }
    var phoneCalls: Int { calls.filter { $0.path == "/api/account/devices/phone" }.count }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let url = request.url else { throw URLError(.badURL) }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary(
            (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { $1 })
        let call = Call(
            method: request.httpMethod ?? "GET", path: url.path, query: query, body: request.httpBody ?? Data(),
            contentType: request.value(forHTTPHeaderField: "Content-Type"),
            authorization: request.value(forHTTPHeaderField: "Authorization"))
        let failing = lock.withLock { () -> Bool in
            guard networkFailures > 0 else { return false }
            networkFailures -= 1
            return true
        }
        if failing { throw URLError(.notConnectedToInternet) }
        let (status, body) = lock.withLock { () -> (Int, Data) in
            _calls.append(call)
            if let refusesToken, call.authorization == "Bearer \(refusesToken)" { return (401, Data()) }
            return answer(call)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else {
            throw URLError(.badServerResponse)
        }
        return (body, response)
    }

    private func json(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }

    /// Under the lock.
    private func answer(_ call: Call) -> (Int, Data) {
        if call.path == "/api/account/devices/phone" {
            phoneRemoved = false
            return phoneAnswer
        }
        let name = call.query["filename"] ?? ""
        if phoneRemoved { return (404, fixture("account.phone-upload.not-found")) }
        if call.method == "GET" {
            if let heldAnswer { return heldAnswer }
            return (200, json(["parts": (held[name] ?? [:]).keys.sorted()]))
        }
        for key in [name, "*"] {
            if var scripted = answers[key], !scripted.isEmpty {
                let next = scripted.removeFirst()
                answers[key] = scripted
                return next
            }
        }
        guard let partText = call.query["part"], let part = Int(partText), let parts = Int(call.query["parts"] ?? "")
        else { return whole(name, call.body) }
        return piece(part, of: parts, name, call)
    }

    /// Under the lock.
    private func piece(_ part: Int, of parts: Int, _ name: String, _ call: Call) -> (Int, Data) {
        if !lose.contains(part) {
            pieces[name, default: held[name] ?? [:]][part] = call.body
        } else {
            lose.remove(part)
        }
        guard part == parts else {
            return (202, json(["part": part, "parts": parts, "have": pieces[name]?.count ?? 0]))
        }
        let have = pieces[name] ?? [:]
        let missing = (1...parts).filter { have[$0] == nil }
        if !missing.isEmpty { return (409, json(["error": "parts_missing", "missing": missing, "parts": parts])) }
        let file = (1...parts).reduce(into: Data()) { $0.append(have[$1] ?? Data()) }
        pieces[name] = nil
        held[name] = nil
        let sha = SHA256.hash(data: file).map { String(format: "%02x", $0) }.joined()
        if sha != call.query["sha256"] { return (422, json(["error": "sha256_mismatch"])) }
        return whole(name, file)
    }

    private func whole(_ name: String, _ file: Data) -> (Int, Data) {
        if _files[name] != nil { return (409, fixture("account.phone-upload.already-uploaded")) }
        _files[name] = file
        return name.hasSuffix("_imu.csv")
            ? (201, fixture("account.phone-upload.motion")) : (201, fixture("account.phone-upload"))
    }
}

/// `id-token`, or `fresh-token` when asked to refresh.
func client(_ server: FakeUploadServer, signedIn: Bool = true) -> PaddleClient {
    PaddleClient(
        baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server, app: "ios/test",
        idToken: { refresh in signedIn ? (refresh ? "fresh-token" : "id-token") : nil })
}

/// A fresh account folder with recordings in it.
func folder() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "uploads-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// Writes `track_<stamp>.csv` (`trackBytes` long), its `_i10.csv` and log.
@discardableResult
func record(
    _ stem: String = "track_20261101_070211", in folder: URL, trackBytes: Int = 300, motionBytes: Int? = 200
) throws -> (track: Data, motion: Data?) {
    let track = Data((0..<trackBytes).map { UInt8(truncatingIfNeeded: $0 * 7 + 1) })
    try track.write(to: folder.appending(path: "\(stem).csv"))
    let motion = motionBytes.map { count in Data((0..<count).map { UInt8(truncatingIfNeeded: $0 * 3 + 2) }) }
    try motion?.write(to: folder.appending(path: "\(stem)_i10.csv"))
    try Data("dropped_late,0\n".utf8).write(to: folder.appending(path: "\(stem).log"))
    return (track, motion)
}

func names(in folder: URL) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []).sorted()
}
