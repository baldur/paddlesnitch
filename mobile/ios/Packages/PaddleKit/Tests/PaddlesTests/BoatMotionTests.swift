import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// mobile/contract/README.md, "Boat motion", from the contract's fixtures.
@MainActor @Suite struct BoatMotionTests {
    func motion(_ name: String) throws -> RecordingMotion {
        try JSONDecoder.paddlesnitch.decode(
            RecordingMotion.self, from: Data(contentsOf: fixtures.appending(path: "\(name).json")))
    }

    func recording(_ paddle: String) async throws -> MotionRecording {
        try #require(MotionRecording(try await SamplePaddles(directory: fixtures).paddle(id: paddle)))
    }

    func measured() throws -> BoatMotionSummary {
        let attitude = try #require(try motion("account.devices-session").attitude)
        return BoatMotionSummary(attitude, strokeRate: 63.513333333333335)
    }

    /// Answers each load from `answers` in turn, and keeps the ETags sent.
    final class Script: @unchecked Sendable {
        private let lock = NSLock()
        private var answers: [Result<PaddleClient.Conditional<RecordingMotion>, any Error>]
        private var _sent: [String?] = []
        var sent: [String?] { lock.withLock { _sent } }

        init(_ answers: [Result<PaddleClient.Conditional<RecordingMotion>, any Error>]) {
            self.answers = answers
        }

        func fetch(_ etag: String?) throws -> PaddleClient.Conditional<RecordingMotion> {
            try lock.withLock {
                _sent.append(etag)
                return try answers.removeFirst().get()
            }
        }
    }

    func model(_ script: Script, paddle: String = "pdl-river") async throws -> BoatMotionModel {
        BoatMotionModel(recording: try await recording(paddle)) { try script.fetch($0) }
    }

    // MARK: Which paddles have it

    @Test func onlyAPaddleFromATrackerOrPhoneHasBoatMotion() async throws {
        let samples = SamplePaddles(directory: fixtures)
        #expect(MotionRecording(try await samples.paddle(id: "pdl-strava")) == nil)
        let river = try await recording("pdl-river")
        #expect(river.deviceId == "a1b2c3d4e5f6" && river.sessionId == "S0012" && !river.phone)
        #expect(try await recording("pdl-phone").phone)
    }

    // MARK: States

    @Test func measuredMotionShowsTheTilesAndCharts() async throws {
        let model = try await model(Script([.success(.changed(try motion("account.devices-session"), etag: "e1"))]))
        await model.load()
        guard case .loaded(let summary) = model.state else { return #expect(Bool(false), "\(model.state)") }
        #expect(summary.tiles.count == 4)
    }

    @Test func noMotionFileYetOffersTheTracker() async throws {
        let model = try await model(
            Script([.success(.changed(try motion("account.devices-session.no-motion"), etag: nil))]))
        await model.load()
        #expect(
            model.state
                == .noMotion(.init(copy: Format.noMotionCopy(reason: nil), open: .tracker)))
        #expect(BoatMotionModel.Device.tracker.button == "Open tracker")
    }

    @Test func aPhonesRecordingOffersThePhone() async throws {
        let script = Script([.success(.changed(try motion("account.devices-session.no-motion"), etag: nil))])
        let model = try await model(script, paddle: "pdl-phone")
        await model.load()
        guard case .noMotion(let none) = model.state else { return #expect(Bool(false)) }
        #expect(none.open == .phone)
        #expect(none.open?.button == "Open phone")
    }

    /// The file arrived and couldn't be measured: no way to the tracker,
    /// and never the engine's own reason.
    @Test func motionThatCouldNotBeMeasuredOffersNothing() async throws {
        let unusable = try motion("account.devices-session.motion-unusable")
        let model = try await model(Script([.success(.changed(unusable, etag: nil))]))
        await model.load()
        guard case .noMotion(let none) = model.state else { return #expect(Bool(false)) }
        #expect(none.open == nil)
        #expect(none.copy.hasPrefix("We couldn’t measure boat motion"))
        #expect(!none.copy.contains(unusable.attitude?.reason ?? "?"))
    }

    @Test func a404IsNotFoundWithNoTryAgain() async throws {
        let refused = PaddleAPIError.rejected(message: "not_found", status: 404, session: nil)
        let model = try await model(Script([.failure(refused)]))
        await model.load()
        #expect(model.state == .notFound)
        #expect(model.failures == 0)
    }

    @Test func aFailedCallCanBeTriedAgain() async throws {
        let measured = try motion("account.devices-session")
        let model = try await model(
            Script([
                .failure(URLError(.notConnectedToInternet)), .failure(PaddleAPIError.badResponse(status: 502)),
                .success(.changed(measured, etag: nil)),
            ]))
        await model.load()
        #expect(model.state == .failed && model.failures == 1)
        await model.load()
        #expect(model.state == .failed && model.failures == 2, "the second failure moves focus back")
        await model.load()
        #expect(model.failures == 0)
        guard case .loaded = model.state else { return #expect(Bool(false)) }
    }

    /// The ETag goes back as If-None-Match; a 304 keeps what's shown.
    @Test func aSecondLoadSendsTheETagAndA304KeepsThePage() async throws {
        let script = Script([
            .success(.changed(try motion("account.devices-session"), etag: "e1")), .success(.unchanged),
        ])
        let model = try await model(script)
        await model.load()
        let first = model.state
        await model.load()
        #expect(script.sent == [nil, "e1"])
        #expect(model.state == first)
    }

    // MARK: What's drawn

    @Test func theTilesAreTheWebsites() throws {
        let tiles = try measured().tiles
        #expect(tiles.map(\.label) == ["Side-to-side roll", "Bow-to-stern pitch", "Evenness", "Stroke rate"])
        #expect(tiles.map(\.value) == ["5.8°", "1.52°", "10%", "64"])
        #expect(tiles.map(\.note) == ["typical lean", "typical tilt", "uneven", "spm"])
        #expect(tiles[0].spoken == "Side-to-side roll, 5.8 degrees, typical lean")
        #expect(tiles[3].spoken == "Stroke rate, 64, strokes per minute")
    }

    @Test func missingValuesAreADash() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        attitude.symmetry = nil
        let tiles = BoatMotionSummary(attitude, strokeRate: nil).tiles
        #expect(tiles[2].value == "—" && tiles[2].note == nil)
        #expect(tiles[3].value == "—" && tiles[3].note == "not measured")
    }

    @Test func throughTheSession() throws {
        let envelope = try measured().envelope
        #expect(envelope.bound == 10.57)
        #expect(envelope.ticks.map(\.label) == ["-9°", "-6°", "-3°", "0°", "3°", "6°", "9°"])
        #expect(envelope.xLabels == ["0 min", "20 min"])
        #expect(envelope.bands.first?.x == 0 && envelope.bands.last?.x == 1)
        #expect(envelope.clippedNote == nil, "nothing in the fixture goes past 10.57°")
        #expect(envelope.spoken == "Roll and pitch through the session, reaching about 11 degrees")
    }

    @Test func valuesPastTheBoundAreClampedAndNoted() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        attitude.envelope[3].rollMax = 25
        let envelope = BoatMotionSummary(attitude, strokeRate: nil).envelope
        #expect(envelope.bands[3].rollMax == 10.57)
        #expect(envelope.clippedNote == "A few moments went past ±11° and are clipped at the chart’s edge.")
    }

    @Test func aNullBoundIsTen() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        attitude.plotBoundDeg = nil
        #expect(BoatMotionSummary(attitude, strokeRate: nil).envelope.bound == 10)
    }

    @Test func strokeShape() throws {
        let excerpt = try measured().excerpt
        #expect(abs(excerpt.bound - 9.04 * 1.1) < 1e-9)
        #expect(excerpt.xLabel == "30 s at 10 Hz")
        #expect(excerpt.roll.count == 300 && excerpt.pitch.count == 300)
    }

    @Test func strokeShapeWithoutARateLeavesItOut() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        attitude.sampleRateHz = nil
        #expect(BoatMotionSummary(attitude, strokeRate: nil).excerpt.xLabel == "30 s")
    }

    @Test func whereTheBoatSpentItsTime() throws {
        let histogram = try #require(try measured().histogram)
        #expect(abs(histogram.halfRange - (9.37 + 0.235)) < 1e-9)
        #expect(abs(histogram.barWidth - 0.47 * 0.86) < 1e-9)
        #expect(histogram.maxCount == 773)
        #expect(histogram.leftLabel == "\u{2212}10°" && histogram.rightLabel == "+10°")
    }

    @Test func theMirrorTakesTheCountOfTheBinNearestMinusCentre() {
        let bins = [
            RollHistogram.Bin(centreDeg: -1, count: 5), RollHistogram.Bin(centreDeg: 0, count: 9),
            RollHistogram.Bin(centreDeg: 1.1, count: 2),
        ]
        let histogram = BoatMotionSummary.histogram(RollHistogram(binWidthDeg: 1, bins: bins))
        #expect(histogram?.mirrored.map(\.count) == [2, 9, 5])
        #expect(histogram?.halfRange == 1.6)
    }

    @Test func fewerThanTwoPointsDrawNothing() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        attitude.envelope = Array(attitude.envelope.prefix(1))
        attitude.excerpt = []
        attitude.rollHistogram?.bins = []
        let summary = BoatMotionSummary(attitude, strokeRate: nil)
        #expect(summary.envelope.bands.isEmpty && summary.envelope.xLabels.isEmpty)
        #expect(summary.excerpt.roll.isEmpty)
        #expect(summary.histogram == nil)
    }

    @Test func theAxisSentenceOnlyWhenUnsure() throws {
        var attitude = try #require(try motion("account.devices-session").attitude)
        #expect(!BoatMotionSummary(attitude, strokeRate: nil).cantTell.contains("hard to tell apart"))
        attitude.axisConfident = false
        #expect(
            BoatMotionSummary(attitude, strokeRate: nil).cantTell.hasSuffix(
                " Roll and pitch were hard to tell apart in this recording."))
    }
}
