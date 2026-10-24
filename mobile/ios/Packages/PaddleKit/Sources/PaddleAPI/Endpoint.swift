/// A REST route the apps call (mobile/contract/api/rest.json): sign-in, for
/// now. The generated `Endpoints` lists them.
public struct Endpoint<Input: Encodable & Sendable, Output: Decodable & Sendable>: Sendable {
    public let method: String
    public let path: String
    /// The statuses the route answers with an `ApiError`.
    public let errorStatuses: Set<Int>

    public init(method: String, path: String, errorStatuses: Set<Int>) {
        self.method = method
        self.path = path
        self.errorStatuses = errorStatuses
    }
}
