import Foundation

/// What the server said to a file, or a piece of one, sent to
/// `POST /api/account/devices/{deviceId}/sessions` (mobile/contract/README.md
/// § Phone recording). The uploader decides what each means.
public struct UploadAnswer: Equatable, Sendable {
    public let status: Int
    /// The server's `error` (`already_uploaded`, `no_points`, …), if any.
    public let error: String?
    /// 409 `parts_missing`: the pieces to send again.
    public let missing: [Int]
    /// 410 says the account was deleted (`accountDeleted: true`).
    public let accountDeleted: Bool
    /// `Retry-After` in seconds (503 while an account is being deleted).
    public let retryAfter: Int?

    public init(
        status: Int, error: String? = nil, missing: [Int] = [], accountDeleted: Bool = false, retryAfter: Int? = nil
    ) {
        self.status = status
        self.error = error
        self.missing = missing
        self.accountDeleted = accountDeleted
        self.retryAfter = retryAfter
    }
}

/// One piece of a file sent in pieces, as the tracker sends them:
/// `&part=N&parts=M&sha256=<hex of the whole file>`.
public struct UploadPiece: Equatable, Sendable {
    public let number: Int
    public let of: Int
    public let sha256: String

    public init(number: Int, of: Int, sha256: String) {
        self.number = number
        self.of = of
        self.sha256 = sha256
    }
}

extension PaddleClient {
    /// Adds this iPhone to the signed-in account: the same install and account
    /// always get the same `deviceId`.
    public func addPhone(installID: String) async throws -> Phone {
        try await send(Endpoints.accountDevicesPhone, PhoneAdd(installId: installID, model: .phoneIos))
    }

    /// The pieces of `filename` the server already holds from an upload that
    /// broke off. 404 (`rejected`, status 404): this phone isn't on the account.
    public func heldParts(deviceID: String, filename: String) async throws -> [Int] {
        try await send(
            Endpoints.getAccountDevicesByDeviceIdSessions, HeldPartsFor(filename: filename),
            pathValues: ["deviceId": deviceID]
        ).parts
    }

    /// Sends a whole file, or one piece of it, as the file's own bytes (not
    /// multipart). Every answer comes back, refusals too; only a sign-in the
    /// server still turns down after a fresh token throws.
    public func uploadRecording(deviceID: String, filename: String, body: Data, piece: UploadPiece?) async throws
        -> UploadAnswer
    {
        guard let token = try await idToken(false) else { throw PaddleAPIError.signedOut }
        var (data, response) = try await transport.send(
            recordingRequest(deviceID: deviceID, filename: filename, body: body, piece: piece, token: token))
        if response.statusCode == 401, let fresh = try await idToken(true), fresh != token {
            (data, response) = try await transport.send(
                recordingRequest(deviceID: deviceID, filename: filename, body: body, piece: piece, token: fresh))
        }
        if response.statusCode == 401 { throw PaddleAPIError.signedOut }
        let refusal = try? JSONDecoder.paddlesnitch.decode(Refusal.self, from: data)
        return UploadAnswer(
            status: response.statusCode, error: refusal?.error, missing: refusal?.missing ?? [],
            accountDeleted: refusal?.accountDeleted == true,
            retryAfter: response.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) })
    }

    func recordingRequest(deviceID: String, filename: String, body: Data, piece: UploadPiece?, token: String)
        -> URLRequest
    {
        let path = Endpoints.postAccountDevicesByDeviceIdSessions.path
            .replacingOccurrences(of: "{deviceId}", with: Self.percentEncoded(deviceID))
        var query = "filename=\(Self.percentEncoded(filename))"
        if let piece { query += "&part=\(piece.number)&parts=\(piece.of)&sha256=\(piece.sha256)" }
        let base =
            baseURL.absoluteString.hasSuffix("/") ? String(baseURL.absoluteString.dropLast()) : baseURL.absoluteString
        var request = URLRequest(url: URL(string: base + path + "?" + query) ?? baseURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(app, forHTTPHeaderField: "x-paddlesnitch-app")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = body
        return request
    }
}

/// An upload's refusal: `{error, missing?}`.
private struct Refusal: Decodable {
    let error: String?
    let missing: [Int]?
    let accountDeleted: Bool?
}
