import Foundation
import PaddleAPI
import Testing

@testable import Paddles

/// The web's own examples (packages/analysis/src/analysis.ts and
/// packages/core/src/format.ts), so the app and the site say the same thing.
@Suite struct FormatTests {
    @Test(arguments: [(3896.0, "1:04:56"), (725, "12:05"), (59.6, "1:00"), (0.0, "0:00"), (3600.0, "1:00:00")])
    func clock(seconds: Double, expected: String) {
        #expect(Format.clock(seconds) == expected)
    }

    @Test func minutesAndSecondsRoundBeforeSplitting() {
        #expect(Format.minutesSeconds(125) == "2:05")
        #expect(Format.minutesSeconds(119.6) == "2:00", "the web's fmtDur says 1:60 here")
    }

    @Test(arguments: [(4.0, "2:05"), (500.0 / 165, "2:45"), (0.2, "—"), (0.0, "—")])
    func split500(speed: Double, expected: String) {
        #expect(Format.split500(speed: speed) == expected)
    }

    @Test func distance() {
        #expect(Format.distance(km: 12.3449) == "12.34 km")
        #expect(Format.distance(km: 0.48305) == "0.48 km")
        #expect(Format.distance(km: 3, noGps: true) == "—")
    }

    @Test func rateWindFlowAndPerStroke() {
        #expect(Format.strokeRate(63.6) == "64 spm")
        #expect(Format.wind(kmh: 11.4) == "11 km/h")
        #expect(Format.flow(m3s: 48.24) == "48.2 m³/s")
        #expect(Format.perStroke(8.36) == "8.4 m")
    }

    @Test(arguments: [(0.0, "N"), (225.0, "SW"), (350.0, "N"), (22.4, "N"), (22.6, "NE"), (270.0, "W")])
    func compass(degrees: Double, expected: String) {
        #expect(Format.compass(degrees: degrees) == expected)
    }

    @Test func datesAreWrittenInUTCLikeTheWeb() throws {
        let date = try #require(ISO8601DateFormatter().date(from: "2026-09-13T23:30:00Z"))
        #expect(Format.weekday(date) == "Sun, 13 Sep 2026")
        #expect(Format.month(date) == "Sep 2026")
    }

    @Test func sourcesAreNamedAndAFileIsNot() {
        #expect(Format.source("device") == "Tracker")
        #expect(Format.source("strava") == "Strava")
        #expect(Format.source("trial") == "Time trial")
        #expect(Format.source("file") == nil)
        #expect(Format.source("carrier-pigeon") == nil)
    }

    /// C's "%.1f" rounds an exact tie to even; JavaScript's toFixed rounds up.
    @Test(arguments: [
        (0.25, 1, "0.3"), (0.125, 2, "0.13"), (1.005, 2, "1.00"), (2.675, 2, "2.67"), (12.0, 2, "12.00"),
        (0.0, 1, "0.0"), (48.24, 1, "48.2"),
    ])
    func fixedRoundsLikeJavaScriptsToFixed(value: Double, digits: Int, expected: String) {
        #expect(Format.fixed(value, digits: digits) == expected)
    }

    @Test func plainNumbersPrintLikeJavaScript() {
        #expect(Format.plain(0) == "0")
        #expect(Format.plain(1.4) == "1.4")
        #expect(Format.plain(12) == "12")
    }

    @Test func otherRecordingsAreNamed() {
        #expect(Format.alsoRecordedBy("strava") == "Strava")
        #expect(Format.alsoRecordedBy("trial") == "a time trial")
        #expect(Format.alsoRecordedBy("device") == "the tracker")
        #expect(Format.alsoRecordedBy("file") == "a file")
        #expect(Format.alsoRecordedBy("carrier-pigeon") == "a file")
    }

    @Test(arguments: [
        (30.0, "30 seconds"), (0.2, "1 second"), (89.0, "89 seconds"), (90.0, "2 minutes"), (5399.0, "90 minutes"),
        (5400.0, "1.5 hours"),
    ])
    func gpsLostSpan(seconds: Double, expected: String) {
        #expect(Format.span(seconds) == expected)
    }

    @Test func noPaddleMessagesMatchTheWeb() {
        #expect(
            Format.noPaddleMessage(.noGps(.init(recordedS: 60)), hasMotion: true)
                == "The GPS never found the sky, so no route was recorded. The boat motion was.")
        #expect(
            Format.noPaddleMessage(.gpsLost(.init(lostAfterS: 19, recordedS: 2400)), hasMotion: true)
                == "The GPS lost the sky 19 seconds after you set off, so no route was recorded after that."
                + " The boat motion was.")
        #expect(
            Format.noPaddleMessage(.tooShort(.init(minM: 200, movedM: 35)), hasMotion: false)
                == "Too short to be a paddle: the boat moved 35 m, and a paddle needs 200 m.")
        #expect(
            Format.noPaddleMessage(.unknown(kind: "eaten_by_seal"), hasMotion: false)
                == "No route was recorded for this paddle.")
    }
}
