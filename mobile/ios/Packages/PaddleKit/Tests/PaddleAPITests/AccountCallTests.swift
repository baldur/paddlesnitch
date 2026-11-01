import Foundation
import Testing

@testable import PaddleAPI

/// The account routes (mobile/contract/README.md, "Account"): REST with the
/// Bearer token, a GET's input in the query string, 401 means refresh and try
/// once more.
@Suite struct AccountCallTests {
    let base = URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/")

    func client(_ transport: FakeTransport, tokens: TokenRecorder) -> PaddleClient {
        PaddleClient(baseURL: base, transport: transport, app: "ios/9.9") { refresh in
            await tokens.token(refresh: refresh)
        }
    }

    @Test func aUserRouteSendsTheBearerTokenAndNoBodyWithoutInput() async throws {
        let transport = FakeTransport(body: Data(#"{"url":"https://example.test/file.json"}"#.utf8))
        let link = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .send(Endpoints.accountExport, NoInput())
        #expect(link.url == "https://example.test/file.json")
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/api/account/export")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
        #expect(request.httpBody == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
    }

    /// 410 with `accountDeleted: true` (C3): the account is gone, with words
    /// for the sign-in screen. A 410 without the flag (a proxy) isn't ours.
    @Test func aDeletedAccountSaysSoOnlyWithTheFlag() async throws {
        let gone = FakeTransport(
            status: 410,
            body: Data(
                #"{"error":"This account was deleted, so its recordings on this phone were removed.","accountDeleted":true}"#
                    .utf8))
        await #expect(
            throws: PaddleAPIError.accountDeleted(
                message: "This account was deleted, so its recordings on this phone were removed.")
        ) {
            _ = try await client(gone, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .send(Endpoints.accountDevicesPhone, PhoneAdd(installId: "install-0123456789abcdef", model: .phoneIos))
        }
        let bare = FakeTransport(status: 410, body: Data(#"{"error":"Gone"}"#.utf8))
        await #expect(throws: PaddleAPIError.rejected(message: "Gone", status: 410, session: nil)) {
            _ = try await client(bare, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .send(Endpoints.accountDevicesPhone, PhoneAdd(installId: "install-0123456789abcdef", model: .phoneIos))
        }
    }

    @Test func aGetsInputGoesInTheQueryString() async throws {
        let transport = FakeTransport(body: Data(#"{"available":true,"slug":"pat-r"}"#.utf8))
        _ = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .send(Endpoints.getAccountHandle, HandleCheck(check: "Pat R+1"))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/api/account/handle?check=Pat%20R%2B1")
        #expect(request.httpBody == nil)
    }

    @Test func aDeleteWithInputSendsItAsJSON() async throws {
        let transport = FakeTransport(body: Data(#"{"ok":true}"#.utf8))
        _ = try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
            .send(Endpoints.deleteAccount, DeleteAccount(refreshToken: "r-1"))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String]
        #expect(body == ["refreshToken": "r-1"])
    }

    @Test func signedOutAUserRouteIsNotSent() async {
        let transport = FakeTransport(body: Data())
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport, tokens: TokenRecorder(current: nil, fresh: nil))
                .send(Endpoints.getAccountTos, NoInput())
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func aTurnedDownTokenIsRefreshedAndTheCallTriedOnceMore() async throws {
        let transport = FakeTransport(answers: [
            (401, Data(#"{"error":"Unauthorized"}"#.utf8)),
            (200, Data(#"{"currentVersion":"002","accepted":true,"acceptances":[]}"#.utf8)),
        ])
        let tokens = TokenRecorder(current: "old", fresh: "new")
        let status = try await client(transport, tokens: tokens).send(Endpoints.getAccountTos, NoInput())
        #expect(status.accepted)
        #expect(
            transport.requests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer old", "Bearer new"])
    }

    @Test func stillTurnedDownIsSignedOut() async {
        let transport = FakeTransport(status: 401, body: Data(#"{"error":"Unauthorized"}"#.utf8))
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport, tokens: TokenRecorder(current: "old", fresh: "old"))
                .send(Endpoints.getAccountTos, NoInput())
        }
    }

    @Test func aRefusalComesBackInTheServersWords() async {
        let transport = FakeTransport(
            status: 400, body: Data(#"{"error":"That handle is taken."}"#.utf8))
        await #expect(throws: PaddleAPIError.rejected(message: "That handle is taken.", status: 400, session: nil)) {
            try await client(transport, tokens: TokenRecorder(current: "id-1", fresh: nil))
                .send(Endpoints.putAccountHandle, HandleClaim(handle: "pat"))
        }
    }

    /// Sign-in routes are public: no token is asked for or sent.
    @Test func aPublicRouteSendsNoToken() async throws {
        let transport = FakeTransport(body: Data(#"{"ok":true}"#.utf8))
        let tokens = TokenRecorder(current: "id-1", fresh: nil)
        _ = try await client(transport, tokens: tokens).send(Endpoints.authLogout, RefreshToken(refreshToken: "r"))
        #expect(transport.requests.first?.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(await tokens.asks.isEmpty)
    }
}
