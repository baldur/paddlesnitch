import Observation
import PaddleAPI

/// The Paddles screen: the list, newest first, and refreshing it.
@MainActor @Observable
public final class PaddleListModel {
    public private(set) var state: Loadable<[PaddleRow]> = .loading
    public private(set) var totals: PaddleTotals?
    public private(set) var logbook: LogbookSummary?
    /// Set when a refresh failed but the earlier list is still on screen.
    public private(set) var refreshFailure: String?

    private let source: any PaddlesSource

    public init(source: any PaddlesSource) {
        self.source = source
    }

    /// Loads the list. While a list is showing, a failure keeps it and says
    /// so in `refreshFailure` instead of blanking the screen.
    public func load() async {
        do {
            let list = try await source.list()
            state = .loaded(list.cards.sorted { $0.paddledAt > $1.paddledAt }.map(PaddleRow.init))
            totals = list.totals
            logbook = LogbookSummary(list.logbook)
            refreshFailure = nil
        } catch {
            if state.value == nil {
                state = .failed(FailureMessage.of(error))
            } else {
                refreshFailure = FailureMessage.of(error)
            }
        }
    }

    /// "In all: 3 paddles, 1.0 km, 6:17 on the water, since Sep 2026."
    public var inAll: String? {
        guard let totals, totals.count > 0 else { return nil }
        let paddles = totals.count == 1 ? "1 paddle" : "\(totals.count) paddles"
        let since = totals.since.map { ", since \(Format.month($0))" } ?? ""
        return "In all: \(paddles), \(String(format: "%.1f", totals.totalKm)) km, "
            + "\(Format.clock(totals.totalS)) on the water\(since)."
    }
}

/// One card in the list, as the web's card writes it (PaddlesList.tsx).
public struct PaddleRow: Identifiable, Hashable, Sendable {
    public let id: String
    /// "Sun, 13 Sep 2026 · Tracker · K1"
    public let heading: String
    public let boatClass: String?
    /// "12.34 km · 1:04:56"
    public let headline: String
    /// "2:05 /500 · 64 spm", or only the rate without GPS.
    public let detail: String
    /// Draw "NO GPS" instead of the route: a paddle that lost its GPS keeps
    /// the stretch it had, which mustn't pass for the whole paddle.
    public let noGps: Bool
    public let route: [Coordinate]
    public let note: String?
    /// "Also recorded by Strava": the outing's other recordings.
    public let alsoRecordedBy: [String]

    public init(_ card: PaddleCard) {
        id = card.id
        let source = Format.source(card.sourceType)
        heading = ([Format.weekday(card.paddledAt)] + [source].compactMap { $0 }).joined(separator: " · ")
        boatClass = card.boatClass?.rawValue
        noGps = card.noGps == true
        headline = "\(Format.distance(km: card.distanceKm, noGps: noGps)) · \(Format.clock(card.durationS))"
        let pace = noGps ? nil : "\(Format.split500(speed: card.cruiseSpeed)) /500"
        detail = [pace, card.avgSR.map(Format.strokeRate)].compactMap { $0 }.joined(separator: " · ")
        route = noGps ? [] : card.route
        note = card.note.flatMap { $0.isEmpty ? nil : $0 }
        alsoRecordedBy = (card.sameOuting ?? []).map { "Also recorded by \(Format.alsoRecordedBy($0.sourceType))" }
    }
}

/// The logbook card at the top of the list. The server works the numbers out
/// (`paddleLogbook()`, shared with the website), so they can't drift.
public struct LogbookSummary: Hashable, Sendable {
    public struct Week: Hashable, Sendable {
        /// The Monday it starts, "2026-10-19".
        public let start: String
        public let km: Double
    }

    public let thisWeek: PaddleSummary.Stat
    public let thisMonth: PaddleSummary.Stat
    public let streak: PaddleSummary.Stat
    /// Oldest first; this week is last.
    public let weeks: [Week]
    /// No paddles in any of the twelve weeks.
    public var isQuiet: Bool { weeks.allSatisfy { $0.km == 0 } }

    public init(_ logbook: Logbook) {
        weeks = logbook.weeks.map { Week(start: $0.week, km: $0.km) }
        thisWeek = .init(label: "This week", value: "\(Format.plain(weeks.last?.km ?? 0)) km", sub: nil)
        thisMonth = .init(
            label: "This month", value: "\(Format.plain(logbook.thisMonthKm)) km",
            sub: "\(Format.plain(logbook.lastMonthKm)) km last month")
        let streak = logbook.streakWeeks
        self.streak =
            streak > 0
            ? .init(label: "Streak", value: "\(streak) wk", sub: streak == 1 ? "week in a row" : "weeks in a row")
            : .init(label: "Streak", value: Format.dash, sub: "start one this week")
    }
}
