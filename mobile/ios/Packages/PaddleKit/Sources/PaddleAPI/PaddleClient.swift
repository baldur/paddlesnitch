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
    /// A REST route said no, with words to show as they are (`ApiError`):
    /// "That email and password don't match." `session` comes with a wrong
    /// email code that can be tried again.
    case rejected(message: String, status: Int, session: String?)
    /// An upload over the size limit in front of the server (413).
    case tooLarge
    /// Right password, but the email's sign-up code was never entered: a new
    /// code has gone out (#702). `message` is a status to show, not an error.
    case codeNeeded(message: String)
}

/// Calls the server as mobile/contract/README.md describes: tRPC procedures
/// over plain HTTP (queries `GET ?input=`, mutations `POST`, answers
/// `{ result: { data } }`) and the REST sign-in routes.
public struct PaddleClient: Sendable {
    public var baseURL: URL
    public var transport: any HTTPTransport
    /// The signed-in user's Cognito ID token, or nil when signed out. With
    /// `refresh` true the old one was turned down: get a new one.
    public var idToken: @Sendable (_ refresh: Bool) async throws -> String?
    /// `x-paddlesnitch-app` on sign-in calls, e.g. `ios/0.1.0`: the server
    /// then answers with tokens instead of setting cookies.
    public var app: String

    public init(
        baseURL: URL, transport: any HTTPTransport = URLSession.shared, app: String = "ios/0",
        idToken: @escaping @Sendable (_ refresh: Bool) async throws -> String?
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.app = app
        self.idToken = idToken
    }

    public func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
        try await call(procedure, NoInput())
    }

    /// Calls a procedure. If the server turns the ID token down (it expired
    /// early, say), it gets a fresh one and tries once more.
    public func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
        let token = try await idToken(false)
        if procedure.auth == .user && token == nil { throw PaddleAPIError.signedOut }
        var (data, response) = try await transport.send(try request(for: procedure, input, token: token))
        if response.statusCode == 401, token != nil, let fresh = try await idToken(true), fresh != token {
            (data, response) = try await transport.send(try request(for: procedure, input, token: fresh))
        }
        return try Self.decode(Output.self, from: data, status: response.statusCode)
    }

    /// Calls a REST route (mobile/contract/api/rest.json). A refusal comes
    /// back as `PaddleAPIError.rejected` with the server's own words.
    /// A `.user` route sends the Bearer token; if the server turns it down,
    /// it gets a fresh one and tries once more.
    /// `pathValues` fill the path's `{parameters}`.
    public func send<Input, Output>(
        _ endpoint: Endpoint<Input, Output>, _ input: Input, pathValues: [String: String] = [:]
    ) async throws -> Output {
        let (data, response) = try await exchange(endpoint, input, pathValues: pathValues, headers: [:])
        return try decodeREST(Output.self, from: data, status: response.statusCode)
    }

    /// What a conditional call came back with.
    public enum Conditional<Output: Sendable>: Sendable {
        /// New or changed, with the ETag to send next time.
        case changed(Output, etag: String?)
        /// 304: what you have is current.
        case unchanged
    }

    /// A GET that sends `etag` as `If-None-Match`: a 304 means what you
    /// have is current.
    public func sendIfChanged<Input, Output>(
        _ endpoint: Endpoint<Input, Output>, _ input: Input, pathValues: [String: String] = [:], etag: String?
    ) async throws -> Conditional<Output> {
        let headers = etag.map { ["If-None-Match": $0] } ?? [:]
        let (data, response) = try await exchange(endpoint, input, pathValues: pathValues, headers: headers)
        if response.statusCode == 304 { return .unchanged }
        let output = try decodeREST(Output.self, from: data, status: response.statusCode)
        return .changed(output, etag: response.value(forHTTPHeaderField: "ETag"))
    }

    private func exchange<Input, Output>(
        _ endpoint: Endpoint<Input, Output>, _ input: Input, pathValues: [String: String], headers: [String: String]
    ) async throws -> (Data, HTTPURLResponse) {
        func call(_ token: String?) async throws -> (Data, HTTPURLResponse) {
            var request = try request(for: endpoint, input, token: token, pathValues: pathValues)
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            return try await transport.send(request)
        }
        guard endpoint.auth == .user else { return try await call(nil) }
        guard let token = try await idToken(false) else { throw PaddleAPIError.signedOut }
        var answer = try await call(token)
        if answer.1.statusCode == 401, let fresh = try await idToken(true), fresh != token {
            answer = try await call(fresh)
        }
        if answer.1.statusCode == 401 { throw PaddleAPIError.signedOut }
        return answer
    }

    /// A REST answer: the output, or the server's words as `rejected`.
    func decodeREST<Output: Decodable>(_ type: Output.Type, from data: Data, status: Int) throws -> Output {
        let decoder = JSONDecoder.paddlesnitch
        if (200..<300).contains(status) {
            do {
                return try decoder.decode(Output.self, from: data)
            } catch let error as DecodingError {
                throw PaddleAPIError.undecodable(String(describing: error))
            }
        }
        if let failure = try? decoder.decode(ApiError.self, from: data) {
            if failure.needsCode == true { throw PaddleAPIError.codeNeeded(message: failure.error) }
            throw PaddleAPIError.rejected(message: failure.error, status: status, session: failure.session)
        }
        throw PaddleAPIError.badResponse(status: status)
    }

    /// A GET's input goes in the query string, one item per field
    /// (`?check=pat`); any other method's goes as a JSON body. Each
    /// `{parameter}` in the path takes its value from `pathValues`,
    /// percent-encoded.
    func request<Input, Output>(
        for endpoint: Endpoint<Input, Output>, _ input: Input, token: String?, pathValues: [String: String] = [:]
    ) throws -> URLRequest {
        var path = String(endpoint.path.drop { $0 == "/" })
        for (name, value) in pathValues {
            path = path.replacingOccurrences(of: "{\(name)}", with: Self.percentEncoded(value))
        }
        guard !path.contains("{") else { throw PaddleAPIError.undecodable("no value for a path parameter in \(path)") }
        var url =
            URL(string: baseURL.absoluteString + (baseURL.absoluteString.hasSuffix("/") ? "" : "/") + path)
            ?? baseURL.appending(path: path)
        let hasInput = !(input is NoInput)
        if hasInput && endpoint.method == "GET" {
            let object = try JSONSerialization.jsonObject(with: try JSONEncoder.paddlesnitch.encode(input))
            let fields = (object as? [String: Any] ?? [:]).sorted { $0.key < $1.key }
            let query = fields.map { "\($0.key)=\(Self.percentEncoded("\($0.value)"))" }.joined(separator: "&")
            url = URL(string: url.absoluteString + "?" + query) ?? url
        }
        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(app, forHTTPHeaderField: "x-paddlesnitch-app")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if hasInput && endpoint.method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.paddlesnitch.encode(input)
        }
        return request
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
