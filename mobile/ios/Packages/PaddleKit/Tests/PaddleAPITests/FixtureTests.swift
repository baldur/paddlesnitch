import Foundation
import Testing

@testable import PaddleAPI

/// The golden answers in mobile/contract/fixtures/api/, which the Android app
/// and the web tests check too.
@Suite struct FixtureTests {
    let decoder = JSONDecoder.paddlesnitch

    @Test func theFixturesAreThere() {
        #expect(Contract.fixtureNames.count >= 6)
    }

    @Test(arguments: Contract.fixtureNames)
    func everyFixtureDecodesAsItsProceduresOutput(name: String) throws {
        let path = try #require(Contract.procedure(forFixture: name), "\(name) matches no procedure")
        _ = try Procedures.decodeOutput(of: path, from: try Contract.fixture(name), using: decoder)
    }

    @Test(arguments: Contract.procedurePaths)
    func everyProcedureHasAFixture(path: String) {
        #expect(Contract.fixtureNames.contains { Contract.procedure(forFixture: $0) == path })
    }

    @Test func signedInMeHasTheUser() throws {
        let me = try decoder.decode(Me.self, from: try Contract.fixture("me.signed-in"))
        #expect(me.user != nil)
    }

    @Test func signedOutMeHasNoUser() throws {
        let me = try decoder.decode(Me.self, from: try Contract.fixture("me.signed-out"))
        #expect(me.user == nil)
    }

    @Test func paddleListHasDatesAndRouteCoordinates() throws {
        let list = try decoder.decode(PaddleList.self, from: try Contract.fixture("paddles.list"))
        #expect(list.totals.count == list.cards.count)
        #expect(list.totals.since == parseTimestamp("2026-09-01T07:30:00Z"))
        let card = try #require(list.cards.first)
        #expect(card.route.first == Coordinate(latitude: 51.45603, longitude: -0.969))
    }

    @Test func aMotionOnlyPaddleSaysWhyThereIsNoRoute() throws {
        let paddle = try decoder.decode(AnalysisSession.self, from: try Contract.fixture("paddles.get.motion-only"))
        #expect(paddle.seat == .cox)
        #expect(paddle.boatClass == .double)
        let noGps = try #require(paddle.result.noGps)
        #expect(noGps.strokes == 2310)
        #expect(noGps.reason == .gpsLost(.init(lostAfterS: 19, recordedS: 2400)))
    }

    /// Contract rule 2: a newer server's values decode to `.unknown`, exactly
    /// where the fixture puts them, and nothing else is lost.
    @Test func unknownValuesDecodeToUnknownCases() throws {
        let paddle = try decoder.decode(AnalysisSession.self, from: try Contract.fixture("paddles.get.unknown-values"))
        #expect(paddle.source.type == .unknown("carrier-pigeon"))
        #expect(paddle.boatClass == .unknown("C1"))
        #expect(paddle.result.noGps?.reason == .unknown(kind: "eaten_by_seal"))
        #expect(paddle.result.stops.first?.kind == .unknown("portage"))
        #expect(paddle.source.deviceName == "paddle01")
        #expect(paddle.result.noGps?.strokes == 12)
    }

    @Test func theKnownFixturesHaveNoUnknownValues() throws {
        for name in ["paddles.get", "paddles.get.motion-only"] {
            let paddle = try decoder.decode(AnalysisSession.self, from: try Contract.fixture(name))
            #expect(AnalysisSource.Kind.known.contains(paddle.source.type), "\(name)")
            if let boatClass = paddle.boatClass { #expect(BoatClass.known.contains(boatClass), "\(name)") }
            for segment in paddle.result.stops + paddle.result.surges {
                #expect(Segment.Kind.known.contains(segment.kind), "\(name)")
            }
        }
    }

    @Test(arguments: ["paddles.get", "paddles.get.motion-only", "paddles.get.unknown-values"])
    func aPaddleSurvivesEncodingAndDecoding(name: String) throws {
        let paddle = try decoder.decode(AnalysisSession.self, from: try Contract.fixture(name))
        let again = try decoder.decode(AnalysisSession.self, from: try JSONEncoder.paddlesnitch.encode(paddle))
        #expect(again == paddle)
    }

    @Test(arguments: [
        ("2026-09-01T07:30:00.000Z", "2026-09-01T07:30:00Z"),
        ("2026-09-01T08:30:00+01:00", "2026-09-01T07:30:00Z"),
        ("2026-09-01T07:30:00.250Z", "2026-09-01T07:30:00.250Z"),
    ])
    func timestampsParseWithOrWithoutFractionsAndOffsets(text: String, same: String) throws {
        let date = try #require(parseTimestamp(text))
        #expect(date == parseTimestamp(same))
    }

    @Test func aBadTimestampFailsToDecode() {
        #expect(throws: DecodingError.self) {
            try JSONDecoder.paddlesnitch.decode([Date].self, from: Data(#"["yesterday"]"#.utf8))
        }
    }
}
