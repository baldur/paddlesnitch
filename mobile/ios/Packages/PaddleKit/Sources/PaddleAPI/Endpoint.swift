/// A REST route the apps call (mobile/contract/api/rest.json): sign-in, the
/// upload and the account. The generated `Endpoints` lists them.
public struct Endpoint<Input: Encodable & Sendable, Output: Decodable & Sendable>: Sendable {
    public let method: String
    public let path: String
    /// `.user`: send the signed-in user's Bearer token.
    public let auth: CallAuth
    /// The statuses the route answers with an `ApiError`.
    public let errorStatuses: Set<Int>

    public init(method: String, path: String, auth: CallAuth = .public, errorStatuses: Set<Int>) {
        self.method = method
        self.path = path
        self.auth = auth
        self.errorStatuses = errorStatuses
    }
}
