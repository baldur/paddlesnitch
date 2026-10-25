import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// The sample server's upload route, which the UI tests add paddles through:
/// the same client call as the real server, and every answer the app handles.
@MainActor @Suite struct SampleUploadTests {
    let server = SampleServer(fixtures: fixtures)
    let gpx = Data("<gpx/>".utf8)

    func signedIn() async throws -> PaddleClient {
        let suite = "sample-upload-\(UUID().uuidString)"
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: MemoryTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        return account.client
    }

    @Test func aFileIsAddedAsASampleThatCanBeOpened() async throws {
        #expect(try await signedIn().upload(fileName: "Morning.gpx", data: gpx) == Analysed(id: "pdl-river"))
    }

    @Test func theFileNamePicksEachOtherAnswer() async throws {
        let client = try await signedIn()
        #expect(
            try await client.upload(fileName: "duplicate.gpx", data: gpx) == Analysed(duplicate: true, id: "pdl-river"))
        await #expect(throws: PaddleAPIError.tooLarge) { try await client.upload(fileName: "huge.gpx", data: gpx) }
        await #expect(
            throws: PaddleAPIError.rejected(
                message: "That file has too few GPS points to analyse.", status: 422, session: nil)
        ) { try await client.upload(fileName: "unreadable.gpx", data: gpx) }
    }
}
