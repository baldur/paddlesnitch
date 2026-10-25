import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Paddles

/// ServerPaddles through the real client against the sample server: the
/// requests the app sends, and the answers it reads.
@Suite struct ServerPaddlesTests {
    let server = SampleServer(fixtures: fixtures, summariesPending: true)

    var paddles: ServerPaddles {
        ServerPaddles(
            client: PaddleClient(
                baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
                idToken: { _ in "token" }))
    }

    @Test func writesASummaryWithAPostOfTheId() async throws {
        #expect(try await paddles.paddle(id: "pdl-river").insightPending == true)
        let written = try await paddles.writeSummary(id: "pdl-river")
        #expect(written.insight.hasPrefix("A short, sharp three minutes"))
        let request = try #require(server.requests.last)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/trpc/paddles.writeSummary")
        #expect(request.httpBody == Data(#"{"id":"pdl-river"}"#.utf8))
        #expect(try await paddles.paddle(id: "pdl-river").insightPending == nil, "written once, not pending again")
    }
}
