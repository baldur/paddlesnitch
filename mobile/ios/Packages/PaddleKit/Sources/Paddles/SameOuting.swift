import Foundation
import Observation
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

/// Opens Compare for one paddle and another recording of its outing, one
/// ask at a time (each web-code link works once). Held by the screen, not
/// the row: a List row scrolled away loses its own state, and with it the
/// failure message and the "no more taps".
@MainActor @Observable
public final class CompareOpener {
    /// The link whose Compare is being asked for: a spinner, no more taps.
    public private(set) var opening: SameOutingLink?
    /// The last ask failed: say "Couldn't open Compare. Please try again."
    public var failed = false
    private let openPage: (String) async -> Bool

    /// `openPage` asks web-code for a website path and opens it, false if
    /// it couldn't.
    public init(openPage: @escaping (String) async -> Bool) {
        self.openPage = openPage
    }

    /// Compare with `paddle` (the one on screen) as `a` and `link` as `b`.
    public func open(paddle: String, link: SameOutingLink) async {
        guard opening == nil else { return }
        opening = link
        failed = await !openPage(SameOutingLink.comparePath(a: paddle, b: link.id))
        opening = nil
    }
}
