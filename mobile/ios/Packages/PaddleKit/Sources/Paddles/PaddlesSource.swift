import Foundation
import PaddleAPI

/// Where the screens get paddles from: the server, or the bundled samples
/// until sign-in arrives (C2) and in UI tests.
public protocol PaddlesSource: Sendable {
    func list() async throws -> PaddleList
    func paddle(id: String) async throws -> AnalysisSession
}

/// The signed-in user's paddles, from the server.
public struct ServerPaddles: PaddlesSource {
    let client: PaddleClient

    public init(client: PaddleClient) {
        self.client = client
    }

    public func list() async throws -> PaddleList {
        try await client.call(Procedures.paddlesList)
    }

    public func paddle(id: String) async throws -> AnalysisSession {
        try await client.call(Procedures.paddlesGet, ById(id: id))
    }
}

/// The contract's golden answers (mobile/contract/fixtures/api/), bundled
/// with the app: real-shaped paddles to show before there's an account.
public struct SamplePaddles: PaddlesSource {
    let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public func list() async throws -> PaddleList {
        try JSONDecoder.paddlesnitch.decode(
            PaddleList.self, from: try Data(contentsOf: directory.appending(path: "paddles.list.json")))
    }

    /// The first `paddles.get*.json` with this id, `paddles.get.json` first.
    public func paddle(id: String) async throws -> AnalysisSession {
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasPrefix("paddles.get") && $0.hasSuffix(".json") }
            .sorted()
        for file in files {
            let data = try Data(contentsOf: directory.appending(path: file))
            if let paddle = try? JSONDecoder.paddlesnitch.decode(AnalysisSession.self, from: data), paddle.id == id {
                return paddle
            }
        }
        throw PaddleAPIError.notFound
    }
}
