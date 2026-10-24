import Foundation

/// Sends a request and returns the raw answer. `URLSession` in the app, a
/// fake in tests.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

extension URLSession: HTTPTransport {
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

public enum PaddleAPIError: Error, Equatable, Sendable {
    /// No signed-in user, or the server no longer accepts the token.
    case signedOut
    case notFound
    /// A tRPC error other than the two above.
    case server(code: String, message: String, status: Int)
    /// An answer that isn't tRPC's shape: a proxy page, an outage.
    case badResponse(status: Int)
    /// The answer didn't match the contract.
    case undecodable(String)
}

/// Calls the server's tRPC procedures over plain HTTP, as
/// mobile/contract/README.md describes: queries are `GET ?input=`, mutations
/// `POST`, answers `{ result: { data } }`.
public struct PaddleClient: Sendable {
    public var baseURL: URL
    public var transport: any HTTPTransport
    /// The signed-in user's Cognito ID token, or nil when signed out.
    public var idToken: @Sendable () async throws -> String?

    public init(
        baseURL: URL, transport: any HTTPTransport = URLSession.shared,
        idToken: @escaping @Sendable () async throws -> String?
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.idToken = idToken
    }

    public func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
        try await call(procedure, NoInput())
    }

    public func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
        let token = try await idToken()
        if procedure.auth == .user && token == nil { throw PaddleAPIError.signedOut }
        let (data, response) = try await transport.send(try request(for: procedure, input, token: token))
        return try Self.decode(Output.self, from: data, status: response.statusCode)
    }

    func request<Input, Output>(for procedure: Procedure<Input, Output>, _ input: Input, token: String?) throws
        -> URLRequest
    {
        let url = baseURL.appending(path: "api/trpc").appending(path: procedure.path)
        let hasInput = !(input is NoInput)
        var request: URLRequest
        switch procedure.kind {
        case .query:
            if hasInput {
                let json = String(bytes: try JSONEncoder.paddlesnitch.encode(input), encoding: .utf8) ?? ""
                let query = "input=" + Self.percentEncoded(json)
                request = URLRequest(url: URL(string: url.absoluteString + "?" + query) ?? url)
            } else {
                request = URLRequest(url: url)
            }
            request.httpMethod = "GET"
        case .mutation:
            request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if hasInput { request.httpBody = try JSONEncoder.paddlesnitch.encode(input) }
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    static func decode<Output: Decodable>(_ type: Output.Type, from data: Data, status: Int) throws -> Output {
        let decoder = JSONDecoder.paddlesnitch
        if (200..<300).contains(status) {
            do {
                return try decoder.decode(Answer<Output>.self, from: data).result.data
            } catch let error as DecodingError {
                throw PaddleAPIError.undecodable(String(describing: error))
            }
        }
        guard let failure = try? decoder.decode(Failure.self, from: data) else {
            throw status == 401 ? PaddleAPIError.signedOut : PaddleAPIError.badResponse(status: status)
        }
        let code = failure.error.data?.code ?? "UNKNOWN"
        switch code {
        case "UNAUTHORIZED": throw PaddleAPIError.signedOut
        case "NOT_FOUND": throw PaddleAPIError.notFound
        default: throw PaddleAPIError.server(code: code, message: failure.error.message, status: status)
        }
    }

    /// Percent-encodes everything but RFC 3986's unreserved characters. Looser
    /// encoding breaks: the server reads `+` in a query as a space.
    static func percentEncoded(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
}

/// A successful tRPC answer: `{ "result": { "data": … } }`.
private struct Answer<Value: Decodable>: Decodable {
    let result: AnswerResult<Value>
}

private struct AnswerResult<Value: Decodable>: Decodable {
    let data: Value
}

/// A tRPC error: `{ "error": { "message": …, "data": { "code": … } } }`.
private struct Failure: Decodable {
    let error: FailureBody
}

private struct FailureBody: Decodable {
    let message: String
    let data: FailureDetails?
}

private struct FailureDetails: Decodable {
    let code: String?
}
