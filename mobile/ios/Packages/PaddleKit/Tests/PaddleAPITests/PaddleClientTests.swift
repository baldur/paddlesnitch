import Foundation
import Testing

@testable import PaddleAPI

/// Records requests and answers them in turn with canned responses; the last
/// one repeats.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private let answers: [(status: Int, body: Data)]

    init(status: Int = 200, body: Data) {
        answers = [(status, body)]
    }

    init(answers: [(status: Int, body: Data)]) {
        self.answers = answers
    }

    var requests: [URLRequest] { lock.withLock { _requests } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let index = lock.withLock {
            _requests.append(request)
            return min(_requests.count, answers.count) - 1
        }
        let answer = answers[index]
        guard let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (answer.body, response)
    }
}

/// Hands out ID tokens and records whether each ask was for a fresh one.
actor TokenRecorder {
    private(set) var asks: [Bool] = []
    let current: String?
    let fresh: String?

    init(current: String?, fresh: String?) {
        self.current = current
        self.fresh = fresh
    }

    func token(refresh: Bool) -> String? {
        asks.append(refresh)
        return refresh ? fresh : current
    }
}

@Suite struct PaddleClientTests {
    let base = URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/")

    func client(_ transport: FakeTransport, token: String? = "id-token") -> PaddleClient {
        PaddleClient(baseURL: base, transport: transport, app: "ios/9.9", idToken: { _ in token })
    }

    // MARK: Requests (the wire format in mobile/contract/README.md)

    @Test func aQueryWithoutInputIsAPlainGet() async throws {
        let transport = FakeTransport(body: try Contract.answer("me.signed-out"))
        _ = try await client(transport, token: nil).call(Procedures.me)
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/api/trpc/me")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func aQuerysInputIsStrictlyPercentEncodedJSON() async throws {
        let transport = FakeTransport(body: try Contract.answer("paddles.get"))
        _ = try await client(transport).call(Procedures.paddlesGet, ById(id: "a+b c/é"))
        #expect(
            transport.requests.first?.url?.absoluteString
                == "https://paddlesnitch.test/api/trpc/paddles.get?input=%7B%22id%22%3A%22a%2Bb%20c%2F%C3%A9%22%7D")
    }

    @Test func aSignedInCallSendsTheBearerToken() async throws {
        let transport = FakeTransport(body: try Contract.answer("paddles.list"))
        _ = try await client(transport, token: "abc.def").call(Procedures.paddlesList)
        #expect(transport.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer abc.def")
    }

    @Test func aUserProcedureSignedOutFailsWithoutCallingTheServer() async throws {
        let transport = FakeTransport(body: Data())
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport, token: nil).call(Procedures.paddlesList)
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func aMutationPostsItsInputAsJSON() async throws {
        let transport = FakeTransport(body: try Contract.answer("me.signed-in"))
        let rename = Procedure<ById, Me>(path: "paddles.rename", kind: .mutation, auth: .user)
        _ = try await client(transport).call(rename, ById(id: "p1"))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/api/trpc/paddles.rename")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.httpBody == Data(#"{"id":"p1"}"#.utf8))
    }

    // MARK: Answers

    @Test func theAnswerIsUnwrappedFromResultData() async throws {
        let transport = FakeTransport(body: try Contract.answer("me.signed-in"))
        let me = try await client(transport).call(Procedures.me)
        #expect(me.user != nil)
    }

    @Test(arguments: [
        (401, "UNAUTHORIZED", PaddleAPIError.signedOut),
        (404, "NOT_FOUND", PaddleAPIError.notFound),
        (
            500, "INTERNAL_SERVER_ERROR",
            PaddleAPIError.server(code: "INTERNAL_SERVER_ERROR", message: "boom", status: 500)
        ),
    ])
    func tRPCErrorsMapToAppErrors(status: Int, code: String, expected: PaddleAPIError) async throws {
        let body = #"{"error":{"message":"boom","code":-32000,"data":{"code":"\#(code)","httpStatus":\#(status)}}}"#
        let transport = FakeTransport(status: status, body: Data(body.utf8))
        await #expect(throws: expected) {
            try await client(transport).call(Procedures.paddlesList)
        }
    }

    @Test func aNonTRPCPageIsABadResponse() async throws {
        let transport = FakeTransport(status: 502, body: Data("<html>Bad gateway</html>".utf8))
        await #expect(throws: PaddleAPIError.badResponse(status: 502)) {
            try await client(transport).call(Procedures.paddlesList)
        }
    }

    @Test func aBare401MeansSignedOut() async throws {
        let transport = FakeTransport(status: 401, body: Data())
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client(transport).call(Procedures.paddlesList)
        }
    }

    @Test func anAnswerThatBreaksTheContractIsUndecodable() async throws {
        let transport = FakeTransport(body: Data(#"{"result":{"data":{"cards":"nope"}}}"#.utf8))
        await #expect {
            try await client(transport).call(Procedures.paddlesList)
        } throws: { error in
            if case .undecodable = error as? PaddleAPIError { true } else { false }
        }
    }

    // MARK: Retrying with a fresh token

    @Test func aTurnedDownTokenIsRefreshedAndTheCallTriedOnce() async throws {
        let unauthorized = Data(#"{"error":{"message":"no","data":{"code":"UNAUTHORIZED"}}}"#.utf8)
        let transport = FakeTransport(answers: [(401, unauthorized), (200, try Contract.answer("paddles.list"))])
        let tokens = TokenRecorder(current: "old", fresh: "new")
        let client = PaddleClient(baseURL: base, transport: transport, idToken: { await tokens.token(refresh: $0) })
        _ = try await client.call(Procedures.paddlesList)
        #expect(await tokens.asks == [false, true])
        #expect(
            transport.requests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer old", "Bearer new"])
    }

    @Test func noFreshTokenMeansSignedOutWithoutASecondTry() async throws {
        let transport = FakeTransport(status: 401, body: Data())
        let tokens = TokenRecorder(current: "old", fresh: nil)
        let client = PaddleClient(baseURL: base, transport: transport, idToken: { await tokens.token(refresh: $0) })
        await #expect(throws: PaddleAPIError.signedOut) {
            try await client.call(Procedures.paddlesList)
        }
        #expect(transport.requests.count == 1)
    }

    // MARK: REST (sign-in)

    @Test func aSignInPostsJSONWithTheAppHeader() async throws {
        let transport = FakeTransport(body: try Contract.fixture("auth.login"))
        let signIn = try await client(transport, token: nil)
            .send(Endpoints.authLogin, Login(email: "pat@example.com", password: "Secret123"))
        #expect(!signIn.refreshToken.isEmpty)
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://paddlesnitch.test/att/api/auth/login")
        #expect(request.value(forHTTPHeaderField: "x-paddlesnitch-app") == "ios/9.9")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try JSONDecoder().decode(Login.self, from: try #require(request.httpBody))
        #expect(body == Login(email: "pat@example.com", password: "Secret123"))
    }

    @Test func aRefusalCarriesTheServersWords() async throws {
        let transport = FakeTransport(status: 401, body: try Contract.fixture("auth.error"))
        await #expect(
            throws: PaddleAPIError.rejected(message: "That email and password don’t match.", status: 401, session: nil)
        ) {
            try await client(transport).send(Endpoints.authLogin, Login(email: "a", password: "b"))
        }
    }

    @Test func aWrongCodeComesBackWithItsNewSession() async throws {
        let transport = FakeTransport(status: 400, body: try Contract.fixture("auth.otp-verify.retry"))
        await #expect {
            try await client(transport).send(Endpoints.authOtpVerify, OtpVerify(code: "1", email: "a", session: "s"))
        } throws: { error in
            if case .rejected(_, 400, let session) = error as? PaddleAPIError { session != nil } else { false }
        }
    }

    @Test func aRefusalThatIsntAnApiErrorIsABadResponse() async throws {
        let transport = FakeTransport(status: 502, body: Data("<html>".utf8))
        await #expect(throws: PaddleAPIError.badResponse(status: 502)) {
            try await client(transport).send(Endpoints.authRefresh, RefreshToken(refreshToken: "r"))
        }
    }
}
