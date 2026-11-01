import Foundation
import PaddleAPI
import Testing

@testable import Paddles

let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // PaddlesTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // PaddleKit
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // mobile
    .appending(path: "contract/fixtures/api")

/// A source that fails, or answers from the samples, optionally as saved
/// before their summaries were written.
actor ScriptedSource: PaddlesSource {
    var failure: (any Error)?
    let samples = SamplePaddles(directory: fixtures)
    let summariesPending: Bool
    let summaryFailure: (any Error)?
    private(set) var written: [String] = []

    init(failure: (any Error)? = nil, summariesPending: Bool = false, summaryFailure: (any Error)? = nil) {
        self.failure = failure
        self.summariesPending = summariesPending
        self.summaryFailure = summaryFailure
    }

    func fail(with error: (any Error)?) {
        failure = error
    }

    func list() async throws -> PaddleList {
        if let failure { throw failure }
        return try await samples.list()
    }

    func paddle(id: String) async throws -> AnalysisSession {
        if let failure { throw failure }
        var paddle = try await samples.paddle(id: id)
        if summariesPending { paddle.insightPending = true }
        return paddle
    }

    func writeSummary(id: String) async throws -> AnalysisSession {
        written.append(id)
        if let summaryFailure { throw summaryFailure }
        var paddle = try await samples.paddle(id: id)
        paddle.insight = "Written just now."
        return paddle
    }
}

@Suite struct SamplePaddlesTests {
    let samples = SamplePaddles(directory: fixtures)

    @Test func listsTheSampleCards() async throws {
        #expect(try await samples.list().cards.count == 3)
    }

    @Test func findsAPaddlePreferringPlainPaddlesGet() async throws {
        let paddle = try await samples.paddle(id: "pdl-river")
        #expect(paddle.source.type == .device, "not the unknown-values copy with the same id")
    }

    @Test func aMissingPaddleIsNotFound() async {
        await #expect(throws: PaddleAPIError.notFound) {
            try await samples.paddle(id: "nope")
        }
    }
}

@MainActor @Suite struct PaddleListModelTests {
    @Test func loadsNewestFirst() async throws {
        let model = PaddleListModel(source: ScriptedSource())
        await model.load()
        let rows = try #require(model.state.value)
        #expect(rows.count == 3)
        let dates = try await SamplePaddles(directory: fixtures).list().cards
            .sorted { $0.paddledAt > $1.paddledAt }.map(\.id)
        #expect(rows.map(\.id) == dates)
    }

    @Test func aRowReadsLikeTheWebCard() async throws {
        let model = PaddleListModel(source: ScriptedSource())
        await model.load()
        let river = try #require(model.state.value?.first { $0.id == "pdl-river" })
        #expect(river.heading.hasSuffix(" · Tracker"))
        #expect(river.boatClass == "K1")
        #expect(river.headline.hasPrefix("0.48 km · "))
        #expect(river.detail.hasSuffix(" spm"))
        #expect(!river.route.isEmpty)
        #expect(river.note == "Headwind on the way back.")
        #expect(river.alsoRecordedBy == ["Also recorded by Strava"])
    }

    /// #789: a phone's paddle says Phone, never Tracker, on its card and in
    /// another card's same outing.
    @Test func aPhonesPaddleSaysPhone() throws {
        let data = try Data(contentsOf: fixtures.appending(path: "paddles.list.with-phone.json"))
        let rows = try JSONDecoder.paddlesnitch.decode(PaddleList.self, from: data).cards.map(PaddleRow.init)
        #expect(rows[0].heading.hasSuffix(" · Phone"))
        #expect(rows[0].alsoRecordedBy == ["Also recorded by Strava"])
        #expect(rows[1].heading.hasSuffix(" · Tracker"))
        #expect(rows[1].alsoRecordedBy == ["Also recorded by the phone"])
    }

    @Test func aPaddleWithoutGPSShowsNoRouteEvenIfItHasAStretch() async throws {
        let model = PaddleListModel(source: ScriptedSource())
        await model.load()
        let motion = try #require(model.state.value?.first { $0.id == "pdl-motion" })
        #expect(motion.noGps)
        #expect(motion.route.isEmpty, "the card's partial route mustn't pass for the paddle")
        #expect(motion.headline.hasPrefix("— · "))
        #expect(!motion.detail.contains("/500"))
    }

    @Test func theLogbookReadsLikeTheWeb() async throws {
        let model = PaddleListModel(source: ScriptedSource())
        await model.load()
        let logbook = try #require(model.logbook)
        #expect(logbook.weeks.count == 12)
        #expect(logbook.thisWeek.value == "0 km")
        #expect(logbook.thisMonth.value == "0 km")
        #expect(logbook.thisMonth.sub == "1.4 km last month")
        #expect(logbook.streak.value == "—")
        #expect(logbook.streak.sub == "start one this week")
        #expect(!logbook.isQuiet, "September's paddles fall inside the twelve weeks")
    }

    @Test(arguments: [(1, "1 wk", "week in a row"), (3, "3 wk", "weeks in a row")])
    func aStreakCountsWeeks(weeks: Int, value: String, sub: String) {
        let logbook = LogbookSummary(
            Logbook(lastMonthKm: 0, streakWeeks: weeks, thisMonthKm: 2.5, weeks: [.init(km: 2.5, week: "2026-10-19")]))
        #expect(logbook.streak.value == value)
        #expect(logbook.streak.sub == sub)
        #expect(logbook.thisWeek.value == "2.5 km")
        #expect(!logbook.isQuiet)
    }

    @Test func totalsSayInAll() async {
        let model = PaddleListModel(source: ScriptedSource())
        await model.load()
        #expect(model.inAll == "In all: 4 paddles, 1.4 km, 9:16 on the water, since Sep 2026.")
    }

    @Test func aFirstLoadFailureShowsWhy() async {
        let model = PaddleListModel(source: ScriptedSource(failure: URLError(.notConnectedToInternet)))
        await model.load()
        #expect(model.state == .failed("Couldn't reach paddlesnitch. Check your connection and try again."))
    }

    @Test func aFailedRefreshKeepsTheList() async {
        let source = ScriptedSource()
        let model = PaddleListModel(source: source)
        await model.load()
        await source.fail(with: PaddleAPIError.signedOut)
        await model.load()
        #expect(model.state.value?.count == 3)
        #expect(model.refreshFailure == "Sign in again to see your paddles.")
        await source.fail(with: nil)
        await model.load()
        #expect(model.refreshFailure == nil)
    }
}

@MainActor @Suite struct PaddleDetailModelTests {
    func summary(_ id: String) async throws -> PaddleSummary {
        let model = PaddleDetailModel(id: id, source: ScriptedSource())
        await model.load()
        return try #require(model.state.value)
    }

    @Test func aGPSPaddleHasTheWebsStatsAndAColouredRoute() async throws {
        let river = try await summary("pdl-river")
        #expect(river.eyebrow == "Tracker · K1")
        #expect(river.stats.map(\.label) == ["TIME", "DISTANCE", "PACE", "STROKE RATE", "PER STROKE"])
        #expect(river.stats[2].sub == "/500, cruising")
        #expect(river.conditions.map(\.value) == ["11 km/h", "48.2 m³/s"])
        #expect(river.conditions.map(\.sub) == ["from the SW", "at Reading"])
        #expect(river.noGpsMessage == nil)
        #expect(!river.route.isEmpty)
        #expect(river.note == "Headwind on the way back.")
        #expect(river.coachSummary != nil)
    }

    /// `source.phone` from JSON, so a wrong key fails here. Until the contract
    /// has `paddles.get.with-phone.json` (#804), the sample gets the key.
    @Test func aPhonesPaddleSaysPhone() throws {
        let data = try Data(contentsOf: fixtures.appending(path: "paddles.get.json"))
        var json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var source = try #require(json["source"] as? [String: Any])
        source["phone"] = true
        json["source"] = source
        let paddle = try JSONDecoder.paddlesnitch.decode(
            AnalysisSession.self, from: try JSONSerialization.data(withJSONObject: json))
        #expect(PaddleSummary(paddle).eyebrow == "Phone · K1")
    }

    @Test func aMotionOnlyPaddleExplainsItself() async throws {
        let motion = try await summary("pdl-motion")
        #expect(motion.stats.map(\.label) == ["PADDLING", "DISTANCE", "STROKE RATE", "STROKES"])
        #expect(motion.stats[1].value == "—")
        #expect(motion.stats[3].value == "2,300")
        #expect(motion.route.isEmpty)
        #expect(motion.note == nil)
        #expect(motion.noGpsMessage?.hasPrefix("The GPS lost the sky 19 seconds after you set off") == true)
    }

    @Test func routeSegmentsJoinUpWithoutGaps() async throws {
        let river = try await summary("pdl-river")
        for (a, b) in zip(river.route, river.route.dropFirst()) {
            #expect(a.coordinates.last == b.coordinates.first)
            #expect(a.colour != b.colour)
        }
        let paddle = try await SamplePaddles(directory: fixtures).paddle(id: "pdl-river")
        let drawn = river.route.reduce(0) { $0 + $1.coordinates.count } - (river.route.count - 1)
        #expect(drawn == paddle.result.points.count)
    }

    @Test func aPaddleWithItsSummaryDoesNotWriteAnother() async throws {
        let source = ScriptedSource()
        let model = PaddleDetailModel(id: "pdl-river", source: source)
        await model.load()
        #expect(await source.written.isEmpty)
        #expect(model.state.value?.summaryPending == false)
    }

    @Test func aPaddleWithoutItsSummaryWritesItAndShowsIt() async throws {
        let source = ScriptedSource(summariesPending: true)
        let model = PaddleDetailModel(id: "pdl-river", source: source)
        await model.load()
        #expect(await source.written == ["pdl-river"])
        let river = try #require(model.state.value)
        #expect(!river.summaryPending)
        #expect(river.coachSummary == "Written just now.")
    }

    @Test func aSummaryThatCannotBeWrittenDropsTheLineAndKeepsThePage() async throws {
        let model = PaddleDetailModel(
            id: "pdl-river",
            source: ScriptedSource(summariesPending: true, summaryFailure: URLError(.notConnectedToInternet)))
        await model.load()
        let river = try #require(model.state.value)
        #expect(!river.summaryPending)
        #expect(river.note == "Headwind on the way back.")
        #expect(!river.stats.isEmpty)
    }

    @Test func aPendingSummaryShowsTheLineUntilWritten() async throws {
        var paddle = try await SamplePaddles(directory: fixtures).paddle(id: "pdl-river")
        paddle.insightPending = true
        #expect(PaddleSummary(paddle).summaryPending)
        #expect(!PaddleSummary(paddle, summaryFailed: true).summaryPending)
    }

    /// The website's words, and no "Try again": trying again won't help.
    @Test func aMissingPaddleSaysSoAndIsGone() async {
        let model = PaddleDetailModel(id: "gone", source: ScriptedSource())
        await model.load()
        #expect(model.state == .failed("We can't find this paddle."))
        #expect(model.gone)
    }

    @Test(arguments: [
        (PaddleAPIError.badResponse(status: 502) as any Error, "Please try again in a moment."),
        (URLError(.notConnectedToInternet), "Couldn't reach paddlesnitch. Check your connection and try again."),
        (PaddleAPIError.signedOut, "Sign in again to see your paddles."),
    ])
    func failuresSayWhatToDo(error: any Error, words: String) {
        #expect(FailureMessage.of(error) == words)
    }
}
