import Foundation
import Testing

@testable import PaddleAPI

/// `POST /paddles/api/analyse` (mobile/contract/README.md, "Adding a paddle
/// from a file"): multipart with one part, `file`, and a Bearer token.
@Suite struct UploadTests {
    let base = URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/")
    let gpx = Data("<gpx><trk/></gpx>".utf8)

    func client(_ transport: FakeTransport, tokens: TokenRecorder) -> PaddleClient {
        PaddleClient(baseURL: base, transport: transport, app: "ios/9.9") { refresh in
            await tokens.token(refresh: refresh)
        }
    }

    @Test func sendsTheFileAsOneMultipartPartWithTheBearerToken() async throws {
        let transport = FakeTransport(body: Data(#"{"id":"pdl-new","analysis":{"ignored":true}}"#.utf8))
        let added = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .upload(fileName: "Morning paddle.gpx", data: gpx)

        #expect(added == Analysed(id: "pdl-new"))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/paddles/api/analyse")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
        #expect(request.value(forHTTPHeaderField: "x-paddlesnitch-app") == "ios/9.9")
        let type = try #require(request.value(forHTTPHeaderField: "Content-Type"))
        #expect(type.hasPrefix("multipart/form-data; boundary="))
        let boundary = String(type.dropFirst("multipart/form-data; boundary=".count))
        let body = try #require(String(bytes: request.httpBody ?? Data(), encoding: .utf8))
        #expect(
            body
                == "--\(boundary)\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"Morning paddle.gpx\"\r\n"
                + "Content-Type: application/octet-stream\r\n\r\n"
                + "<gpx><trk/></gpx>\r\n"
                + "--\(boundary)--\r\n")
    }

    @Test func aQuoteInTheFileNameCannotBreakTheHeader() async throws {
        let transport = FakeTransport(body: Data(#"{"id":"pdl-new"}"#.utf8))
        _ = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .upload(fileName: "a\"b\r\n.gpx", data: gpx)
        let body = try #require(String(bytes: transport.requests.first?.httpBody ?? Data(), encoding: .utf8))
        #expect(body.contains("filename=\"a_b__.gpx\""))
    }

    @Test func aPaddleThatWasAlreadyThereSaysSo() async throws {
        let transport = FakeTransport(body: Data(#"{"id":"pdl-old","duplicate":true}"#.utf8))
        let added = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .upload(fileName: "a.fit", data: gpx)
        #expect(added == Analysed(duplicate: true, id: "pdl-old"))
    }

    @Test func signedOutDoesNotSendTheFile() async throws {
        let transport = FakeTransport(body: Data())
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport, tokens: TokenRecorder(current: nil, fresh: nil))
                .upload(fileName: "a.gpx", data: gpx)
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func aTurnedDownTokenIsRefreshedAndTheFileSentOnceMore() async throws {
        let transport = FakeTransport(answers: [
            (401, Data(#"{"error":"Sign in to analyse and save paddles."}"#.utf8)),
            (200, Data(#"{"id":"pdl-new"}"#.utf8)),
        ])
        let tokens = TokenRecorder(current: "old", fresh: "new")
        let added = try await client(transport, tokens: tokens).upload(fileName: "a.gpx", data: gpx)
        #expect(added.id == "pdl-new")
        #expect(
            transport.requests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer old", "Bearer new"])
        #expect(await tokens.asks == [false, true])
    }

    @Test func stillTurnedDownMeansSignedOut() async throws {
        let transport = FakeTransport(
            status: 401, body: Data(#"{"error":"Sign in to analyse and save paddles."}"#.utf8))
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport, tokens: TokenRecorder(current: "old", fresh: "old"))
                .upload(fileName: "a.gpx", data: gpx)
        }
    }

    @Test func aFileTheServerCannotReadComesBackInItsOwnWords() async throws {
        let transport = FakeTransport(
            status: 422, body: Data(#"{"error":"That file has too few GPS points to analyse."}"#.utf8))
        await #expect(
            throws: PaddleAPIError.rejected(
                message: "That file has too few GPS points to analyse.", status: 422, session: nil)
        ) {
            try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .upload(fileName: "a.gpx", data: gpx)
        }
    }

    /// The limit sits in front of the app (413, no `ApiError` body), so the
    /// app doesn't guess the number: it goes by the status.
    @Test func aFileOverTheLimitIsTooLarge() async throws {
        let transport = FakeTransport(status: 413, body: Data("<html>Request Entity Too Large</html>".utf8))
        await #expect(throws: PaddleAPIError.tooLarge) {
            try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .upload(fileName: "a.gpx", data: gpx)
        }
    }

    @Test func anOutageIsABadResponse() async throws {
        let transport = FakeTransport(status: 502, body: Data("<html>Bad gateway</html>".utf8))
        await #expect(throws: PaddleAPIError.badResponse(status: 502)) {
            try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .upload(fileName: "a.gpx", data: gpx)
        }
    }
}
