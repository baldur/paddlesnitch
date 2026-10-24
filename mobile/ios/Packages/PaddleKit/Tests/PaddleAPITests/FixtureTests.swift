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

    /// A tRPC fixture decodes as its procedure's output. A REST fixture
    /// decodes as its route's answer, or, if it carries `error`, as the
    /// `ApiError` that route can answer with.
    @Test(arguments: Contract.fixtureNames)
    func everyFixtureDecodesAsItsAnswer(name: String) throws {
        let data = try Contract.fixture(name)
        if let path = Contract.procedure(forFixture: name) {
            _ = try Procedures.decodeOutput(of: path, from: data, using: decoder)
        } else if Contract.isErrorAnswer(name) {
            #expect(name.hasPrefix("auth."), "an error answer for no known routes")
            _ = try decoder.decode(ApiError.self, from: data)
        } else {
            let route = try #require(Contract.route(forFixture: name), "\(name) matches no procedure or route")
            _ = try Endpoints.decodeOutput(of: route, from: data, using: decoder)
        }
    }

    @Test func aSignInCarriesTheTokensAndNeedsTermsDefaultsToNo() throws {
        let signIn = try decoder.decode(SignIn.self, from: try Contract.fixture("auth.login"))
        #expect(!signIn.idToken.isEmpty && !signIn.refreshToken.isEmpty)
        #expect(signIn.needsTerms != true)
        let older = try decoder.decode(SignIn.self, from: try Contract.fixture("auth.login.needs-terms"))
        #expect(older.needsTerms == true)
    }

    @Test func aWrongCodeComesBackWithANewSession() throws {
        let retry = try decoder.decode(ApiError.self, from: try Contract.fixture("auth.otp-verify.retry"))
        #expect(retry.session?.isEmpty == false)
        #expect(!retry.error.isEmpty)
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
        // Cards group recordings of one outing; totals count every recording.
        let recordings = list.cards.reduce(0) { $0 + 1 + ($1.sameOuting?.count ?? 0) }
        #expect(list.totals.count == recordings)
        #expect(list.totals.since == parseTimestamp("2026-09-01T07:30:00Z"))
        let card = try #require(list.cards.first)
        #expect(card.route.first == Coordinate(latitude: 51.45603, longitude: -0.969))
    }

    @Test func theLogbookHasTwelveWeeksOldestFirst() throws {
        let logbook = try decoder.decode(PaddleList.self, from: try Contract.fixture("paddles.list")).logbook
        #expect(logbook.weeks.count == 12)
        #expect(logbook.weeks.map(\.week) == logbook.weeks.map(\.week).sorted())
    }

    @Test func cardsCarryNoGpsNoteAndOtherRecordingsOfTheOuting() throws {
        let cards = try decoder.decode(PaddleList.self, from: try Contract.fixture("paddles.list")).cards
        let motion = try #require(cards.first { $0.id == "pdl-motion" })
        #expect(motion.noGps == true)
        let river = try #require(cards.first { $0.id == "pdl-river" })
        #expect(river.noGps == nil)
        #expect(river.note == "Headwind on the way back.")
        #expect(river.sameOuting?.map(\.id) == ["pdl-river-watch"])
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
