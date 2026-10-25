/// A tRPC procedure: its path and its input and output types. The generated
/// `Procedures` lists every one the app calls.
public struct Procedure<Input: Encodable & Sendable, Output: Decodable & Sendable>: Sendable {
    public enum Kind: Sendable {
        case query, mutation
    }

    public typealias Auth = CallAuth

    public let path: String
    public let kind: Kind
    public let auth: Auth

    public init(path: String, kind: Kind, auth: Auth) {
        self.path = path
        self.kind = kind
        self.auth = auth
    }
}

/// Who may call a procedure or route.
public enum CallAuth: Sendable {
    /// Works signed out; signed in, the server answers for the user.
    case `public`
    /// Needs a signed-in user.
    case user
}

/// The input of a procedure that takes none.
public struct NoInput: Encodable, Sendable {
    public init() {}
}

public enum ProcedureError: Error, Equatable {
    case unknownPath(String)
}
