import Foundation
import Testing

@testable import PaddleAPI

/// Answers with one status, body and headers, and keeps the request.
final class HeaderTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    let status: Int
    let body: Data
    let headers: [String: String]

    init(status: Int, body: Data = Data(), headers: [String: String] = [:]) {
        self.status = status
        self.body = body
        self.headers = headers
    }

    var requests: [URLRequest] { lock.withLock { _requests } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { _requests.append(request) }
        guard let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)
        else { throw URLError(.badURL) }
        return (body, response)
    }
}

/// A route with a parameter in its path, and a conditional GET
/// (mobile/contract/README.md, Account → "Boat motion").
@Suite struct PathAndETagTests {
    let base = URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/")
    let motion = Data(#"{"attitude":null,"cadence":null}"#.utf8)

    func client(_ transport: HeaderTransport) -> PaddleClient {
        PaddleClient(baseURL: base, transport: transport, app: "ios/9.9", idToken: { _ in "id-token" })
    }

    @Test func thePathTakesItsValuePercentEncodedAndTheInputGoesInTheQuery() async throws {
        let transport = HeaderTransport(status: 200, body: motion)
        _ = try await client(transport).send(
            Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: "dev 1/a"),
            pathValues: ["sessionId": "s/1 2"])
        let url = try #require(transport.requests.first?.url)
        #expect(
            url.absoluteString
                == "https://paddlesnitch.test/api/account/devices/sessions/s%2F1%202?deviceId=dev%201%2Fa")
    }

    @Test func aMissingPathValueIsRefusedBeforeCalling() async throws {
        let transport = HeaderTransport(status: 200, body: motion)
        await #expect(throws: PaddleAPIError.self) {
            _ = try await client(transport).send(
                Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: "d"))
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func aChangedAnswerComesWithItsETag() async throws {
        let transport = HeaderTransport(status: 200, body: motion, headers: ["ETag": #""abc""#])
        let answer = try await client(transport).sendIfChanged(
            Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: "d"), pathValues: ["sessionId": "s"],
            etag: nil)
        guard case .changed(let output, let etag) = answer else {
            Issue.record("expected changed")
            return
        }
        #expect(output.attitude == nil)
        #expect(etag == #""abc""#)
        #expect(transport.requests.first?.value(forHTTPHeaderField: "If-None-Match") == nil)
    }

    @Test func a304MeansWhatYouHaveIsCurrent() async throws {
        let transport = HeaderTransport(status: 304)
        let answer = try await client(transport).sendIfChanged(
            Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: "d"), pathValues: ["sessionId": "s"],
            etag: #""abc""#)
        guard case .unchanged = answer else {
            Issue.record("expected unchanged")
            return
        }
        #expect(transport.requests.first?.value(forHTTPHeaderField: "If-None-Match") == #""abc""#)
        #expect(transport.requests.first?.value(forHTTPHeaderField: "x-paddlesnitch-app") == "ios/9.9")
    }

    @Test func a404IsTheServersRefusal() async throws {
        let transport = HeaderTransport(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
        await #expect(throws: PaddleAPIError.rejected(message: "Not found", status: 404, session: nil)) {
            _ = try await client(transport).sendIfChanged(
                Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: "d"),
                pathValues: ["sessionId": "s"], etag: nil)
        }
    }
}
