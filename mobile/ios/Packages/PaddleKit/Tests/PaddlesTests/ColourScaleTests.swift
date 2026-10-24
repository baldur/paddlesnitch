import PaddleAPI
import Testing

@testable import Paddles

@Suite struct ColourScaleTests {
    typealias RGB = ColourScale.RGB

    @Test(arguments: [
        (0.0, RGB(red: 37, green: 99, blue: 235)),
        (0.4, RGB(red: 6, green: 182, blue: 212)),
        (0.7, RGB(red: 234, green: 179, blue: 8)),
        (1.0, RGB(red: 220, green: 38, blue: 38)),
        (0.2, RGB(red: 22, green: 141, blue: 224)),
        (-3.0, RGB(red: 37, green: 99, blue: 235)),
        (9.0, RGB(red: 220, green: 38, blue: 38)),
    ])
    func rampMatchesTheWebsStops(t: Double, expected: RGB) {
        #expect(ColourScale.ramp(t) == expected)
    }

    func points(_ speeds: [Double?]) -> [AnalysisPoint] {
        speeds.enumerated().map { index, speed in
            AnalysisPoint(dps: nil, lat: 51, lng: -1, speed: speed ?? 0, sr: speed, t: Double(index))
        }
    }

    @Test func boundsAreTheTenthAndNinetiethPercentiles() throws {
        let bounds = try #require(ColourScale.bounds(points((1...10).map(Double.init)), metric: .speed))
        #expect(bounds.low == 2)
        #expect(bounds.high == 10)
    }

    @Test func fewerThanTwoValuesHaveNoScale() {
        #expect(ColourScale.bounds(points([3]), metric: .speed) == nil)
        #expect(ColourScale.colours(points([3]), metric: .speed) == [ColourScale.missing])
    }

    @Test func aMissingStrokeRateIsGrey() {
        let colours = ColourScale.colours(points([2, nil, 4, 6]), metric: .strokeRate)
        #expect(colours[1] == ColourScale.missing)
        #expect(colours[0] != ColourScale.missing)
    }
}
