import Foundation
import PaddleAPI

/// Another recording of the same outing, which opens Compare
/// (mobile/contract/README.md, "Same outing"): a row on the paddle's card,
/// a link on its page.
public struct SameOutingLink: Hashable, Sendable {
    /// The other paddle: Compare's `b`.
    public let id: String
    /// "the phone", "Strava", "a file"…
    public let who: String

    public init(id: String, sourceType: String, phone: Bool?) {
        self.id = id
        who = Format.alsoRecordedBy(sourceType, phone: phone)
    }

    public init(_ item: PaddleCard.SameOutingItem) {
        self.init(id: item.id, sourceType: item.sourceType, phone: item.phone)
    }

    public init(_ entry: SameOuting) {
        self.init(id: entry.id, sourceType: entry.sourceType, phone: entry.phone)
    }

    /// "Also recorded by the phone"
    public var text: String { "Also recorded by \(who)" }
    /// What a screen reader says: the arrow isn't read.
    public var spoken: String { "Compare with the recording from \(who)" }

    /// The website's comparison of two paddles: `a` is the one on screen.
    public static func comparePath(a: String, b: String) -> String {
        var path = URLComponents()
        path.path = "/paddles/compare"
        path.queryItems = [URLQueryItem(name: "a", value: a), URLQueryItem(name: "b", value: b)]
        return path.string ?? "/paddles/compare"
    }
}
