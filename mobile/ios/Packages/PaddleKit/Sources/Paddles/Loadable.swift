import Foundation
import PaddleAPI

/// A screen's data: still loading, there, or failed with words to show.
public enum Loadable<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    public var value: Value? {
        if case .loaded(let value) = self { value } else { nil }
    }
}

extension Loadable: Equatable where Value: Equatable {}

/// What to tell someone when loading failed.
public enum FailureMessage {
    public static func of(_ error: any Error) -> String {
        switch error {
        case PaddleAPIError.signedOut:
            "Sign in again to see your paddles."
        case PaddleAPIError.notFound:
            "We can't find this paddle."
        case PaddleAPIError.rejected(let message, _, _):
            message
        case is URLError:
            "Couldn't reach paddlesnitch. Check your connection and try again."
        default:
            // Under a "Couldn't load …" title, or after "Couldn't refresh".
            "Please try again in a moment."
        }
    }
}
