import PaddleAPI
import Testing

@testable import Paddles

@MainActor @Suite struct EffortsTests {
    func summary(_ id: String) async throws -> PaddleSummary {
        let model = PaddleDetailModel(id: id, source: ScriptedSource())
        await model.load()
        return try #require(model.state.value)
    }

    @Test func theRiverPaddleListsItsEffortAndRestAsTheWebDoes() async throws {
        let river = try await summary("pdl-river")
        #expect(
            river.efforts == [
                .init(number: 1, at: "1:53", lasted: "1:06", pace: "2:31", spm: "64", trend: "steady")
            ])
        #expect(river.rests == ["29 s at 1:23"])
        #expect(river.repeats.isEmpty, "a set of one effort isn't a repeat")
        #expect(river.splits.isEmpty, "483 m is under one split")
        // The 10th and 90th percentile speeds; the slow end is the rest.
        #expect(river.legend == .init(slower: "17:44/500", faster: "2:31/500"))
    }

    @Test func aPaddleWithoutGPSHasNoLegendOrSplits() async throws {
        let motion = try await summary("pdl-motion")
        #expect(motion.legend == nil)
        #expect(motion.splits.isEmpty)
        #expect(motion.efforts.isEmpty && motion.rests.isEmpty)
    }

    @Test func repeatsAreSetsOfMoreThanOneEffort() {
        let sets = [
            SessionSet(avgDurS: 90, avgSR: 71.6, avgSpeed: 4, count: 4),
            SessionSet(avgDurS: 60, avgSpeed: 4, count: 1),
            SessionSet(avgDurS: 30, avgSpeed: 4, count: 2),
        ]
        #expect(PaddleSummary.repeats(sets) == ["4 × 1:30 at 2:05/500, 72 spm", "2 × 0:30 at 2:05/500"])
    }

    @Test func restsFromAMinuteUpAreMinutesAndSeconds() {
        func rest(_ seconds: Double, at fromT: Double) -> Segment {
            Segment(
                avgSpeed: 0.5, distM: 10, durS: seconds, fromT: fromT, kind: .rest, splitPer500: 0,
                toT: fromT + seconds)
        }
        #expect(PaddleSummary.rests([rest(29.5, at: 83), rest(130, at: 845)]) == ["30 s at 1:23", "2:10 at 14:05"])
    }

    @Test func effortsWithoutAStrokeRateOrTrendSayNothing() {
        let surge = Segment(
            avgSpeed: 4, distM: 300, durS: 75, fromT: 3600, kind: .surge, splitPer500: 125, toT: 3675, trend: "")
        #expect(
            PaddleSummary.efforts([surge]) == [
                .init(number: 1, at: "1:00:00", lasted: "1:15", pace: "2:05", spm: "—", trend: nil)
            ])
    }

    /// Due north at 0.001° (111.19 m) every 30 s: 3.71 m/s, so 2:15/500, and
    /// 1,223 m in all.
    @Test func splitsInterpolateEachMarkAndKeepALastPartOver100m() {
        let points = (0..<12).map { i in
            AnalysisPoint(lat: 51.0 + Double(i) * 0.001, lng: -1.0, speed: 3.7, sr: 60, t: 1000 + Double(i) * 30)
        }
        let splits = PaddleSummary.splits(points)
        #expect(splits.map(\.km) == ["0.5", "1.0", "1.22"])
        #expect(splits.map(\.at) == ["2:15", "4:30", "5:30"])
        #expect(splits.map(\.pace) == ["2:15", "2:15", "2:15"])
        #expect(splits.map(\.spm) == ["60", "60", "60"])
    }

    @Test func aLastPartUnder100mHasNoRow() {
        let points = (0..<6).map { i in
            AnalysisPoint(lat: 51.0 + Double(i) * 0.001, lng: -1.0, speed: 3.7, t: Double(i) * 30)
        }
        // 556 m: one split, and 56 m left over.
        #expect(PaddleSummary.splits(points).map(\.km) == ["0.5"])
        #expect(PaddleSummary.splits(points).map(\.spm) == ["—"])
    }
}
