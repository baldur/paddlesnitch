import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Paddles

/// The trackers screen, as the website's /devices: one card per summary, in
/// the server's order, with its verdicts (firmware state, quiet, crash) as
/// given, never worked out here. Written from the contract's fixtures.
@Suite struct TrackersTests {
    let now = Date(timeIntervalSince1970: 1_792_929_600)  // 2026-10-25T12:00:00Z

    func list(_ name: String = "account.devices") throws -> TrackerList {
        try JSONDecoder.paddlesnitch.decode(
            TrackerList.self, from: Data(contentsOf: fixtures.appending(path: "\(name).json")))
    }

    func recordings() throws -> [Recording] {
        let data = try Data(contentsOf: fixtures.appending(path: "account.devices-sessions.json"))
        return try JSONDecoder.paddlesnitch.decode(RecordingList.self, from: data).sessions
    }

    @Test func theCardsComeInTheServersOrder() throws {
        let cards = TrackerCard.cards(from: try list(), now: now)
        #expect(cards.map(\.id) == ["C0FFEE01", "C0FFEE02", "BADC0DE9"])
    }

    @Test func anUpToDateTrackerSaysSoAndWhenItWasSeen() throws {
        let card = try #require(TrackerCard.cards(from: try list(), now: now).first)
        #expect(card.name == "Tracker C0FFEE01")
        #expect(!card.removed)
        #expect(card.status?.text == "firmware 0.19.3 · beta · up to date · seen 4h ago")
        #expect(card.status?.parts.first { $0.text == " · up to date" }?.tone == .green)
        #expect(card.status?.parts.first { $0.text == "4h ago" }?.tone == .fg, "not quiet")
        #expect(card.recordings == "12 recordings · 84.21 km · 9 with boat motion · latest 24 Oct 2026")
        #expect(card.identity == "C0FFEE01 · tbeam-s3-supreme")
    }

    @Test func aQuietTrackerWithAnUpdateAndACrashSaysAllThree() throws {
        let card = try #require(TrackerCard.cards(from: try list(), now: now).dropFirst().first)
        #expect(
            card.status?.text
                == "firmware 0.18.1 · update pending (0.18.2) · seen 4d ago · quiet · crashed 4d ago (uplink)")
        #expect(card.status?.parts.first { $0.text == " · quiet" }?.tone == .red, "in words, not colour alone")
        #expect(card.status?.parts.first { $0.text == " · update pending (0.18.2)" }?.tone == .split)
        #expect(card.status?.parts.first { $0.text == "4d ago" }?.tone == .red, "quiet, as the server says")
        #expect(card.status?.parts.last?.tone == .red)
        #expect(card.recordings == "3 recordings · 15.40 km · latest 20 Oct 2026")
    }

    /// VoiceOver hears a sentence, not codes: times spelled out, the id left
    /// out (it's support's), "removed" said where it belongs.
    @Test func aCardReadsAsASentence() throws {
        let cards = TrackerCard.cards(from: try list(), now: now)
        #expect(
            cards[1].spoken
                == "Tracker C0FFEE02, firmware 0.18.1, update pending (0.18.2), seen 4 days ago, quiet, "
                + "crashed 4 days ago (uplink), 3 recordings, 15.40 km, latest 20 Oct 2026")
        #expect(cards[2].spoken.hasPrefix("Tracker BADC0DE9, removed, 2 recordings"))
    }

    @Test func aTrackerNeverSeenSaysSo() {
        let summary = TrackerSummary(
            deviceId: "D1", distanceMetres: 0, firmwareState: .unknown, linked: true, motionRecordings: 0, name: "New",
            quiet: false, recordings: 0)
        #expect(
            TrackerCard(summary: summary, tracker: nil, stable: nil, now: now).status?.text
                == "firmware unknown · seen never")
    }

    @Test func aRemovedTrackerWithRecordingsStaysWithoutAStatus() throws {
        let card = try #require(TrackerCard.cards(from: try list(), now: now).last)
        #expect(card.removed)
        #expect(card.status == nil)
        #expect(card.recordings == "2 recordings · 9.80 km · 1 with boat motion · latest 14 Jul 2026")
        #expect(card.identity == "BADC0DE9")
    }

    /// A phone that records is a device on the account too (C3): it never
    /// gets a tracker card, with its firmware line and Remove tracker. Nor
    /// does a kind this app doesn't know yet.
    @Test func phonesAndUnknownKindsGetNoTrackerCard() throws {
        var list = try list()
        list.summaries[0].kind = .phone
        list.summaries[1].kind = .unknown("watch")
        list.summaries[2].kind = .tracker
        #expect(TrackerCard.cards(from: list, now: now).map(\.id) == ["BADC0DE9"])
    }

    @Test func aSummaryWithoutAKindIsATracker() throws {
        // Servers before C3 send no kind.
        #expect(try list().summaries.allSatisfy { $0.kind == nil })
        #expect(TrackerCard.cards(from: try list(), now: now).count == 3)
    }

    @Test func noTrackersMeansNoCards() throws {
        #expect(TrackerCard.cards(from: try list("account.devices.none"), now: now).isEmpty)
    }

    @Test func aTrackerWithNoRecordingsSaysSo() {
        let summary = TrackerSummary(
            deviceId: "D1", distanceMetres: 0, firmwareState: .unknown, linked: true, motionRecordings: 0, name: "New",
            quiet: false, recordings: 0)
        #expect(TrackerCard(summary: summary, tracker: nil, stable: nil, now: now).recordings == "no recordings yet")
    }

    @Test func aRecordingThatBecameAPaddleOpensIt() throws {
        let rows = RecordingRow.rows(from: try recordings(), deviceId: "C0FFEE01", zone: .gmt)
        let river = try #require(rows.first)
        #expect(river.title == "25 Oct 2026, 07:02 · 8.24 km")
        #expect(river.detail == "paddle · with boat motion")
        #expect(river.paddleID == "pdl_8Kq2Zr")
    }

    @Test func aRecordingWithNoPaddleSaysSoWithItsFile() throws {
        let rows = RecordingRow.rows(from: try recordings(), deviceId: "C0FFEE01", zone: .gmt)
        let noFix = try #require(rows.first { $0.id == "rec-no-fix" })
        #expect(noFix.title == "24 Oct 2026, 19:00", "the upload's time when it never started")
        #expect(noFix.detail == "not a paddle · track_20261024_1800.csv")
        #expect(noFix.paddleID == nil)
    }

    @Test func onlyThisTrackersRecordingsInTheServersOrder() throws {
        let all = try recordings()
        let rows = RecordingRow.rows(from: all, deviceId: "C0FFEE01", zone: .gmt)
        #expect(rows.map(\.id) == all.filter { $0.deviceId == "C0FFEE01" }.map(\.sessionId))
    }
}

/// Loading and removing, through the client against the sample server.
@MainActor @Suite struct TrackersModelTests {
    let server = SampleServer(fixtures: fixtures)
    let now = Date(timeIntervalSince1970: 1_792_929_600)

    func model(signedIn: Bool = true) -> TrackersModel {
        let client = PaddleClient(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server, app: "ios/1.0"
        ) { _ in signedIn ? "id-token" : nil }
        return TrackersModel(source: ServerTrackers(client: client), now: { [now] in now }, zone: .gmt)
    }

    @Test func loadingShowsTheCardsAndKnowsEachTrackersRecordings() async {
        let model = model()
        await model.load()
        #expect(model.state.value?.map(\.id) == ["C0FFEE01", "C0FFEE02", "BADC0DE9"])
        #expect(model.recordings(of: "C0FFEE01")?.first?.paddleID == "pdl-river", "a sample that opens")
    }

    @Test func removingATrackerKeepsItsCardAsRemoved() async {
        let model = model()
        await model.load()
        #expect(await model.remove("C0FFEE01") == nil)
        let card = model.state.value?.first { $0.id == "C0FFEE01" }
        #expect(card?.removed == true, "its recordings stay, so the card does too")
        #expect(server.requests.contains { $0.httpMethod == "DELETE" && $0.url?.path == "/api/account/devices" })
    }

    @Test func aFailedRemoveSaysSoInTheWebsitesWords() async {
        let model = model()
        await model.load()
        server.failsTrackerRemoval = true
        #expect(await model.remove("C0FFEE01") == "Couldn’t remove the tracker. Please try again.")
        #expect(model.state.value?.first?.removed == false)
    }

    /// The cards don't wait on the recordings: they load apart.
    @Test func aRecordingsFailureLeavesTheCards() async {
        let model = model()
        server.failsTrackerRecordings = true
        await model.load()
        #expect(model.state.value?.count == 3)
        #expect(model.recordingsState == .failed("Please try again in a moment."))
        server.failsTrackerRecordings = false
        await model.loadRecordings()
        #expect(model.recordingsState.value != nil)
    }

    @Test func aFailedRefreshKeepsTheCardsAndSaysSo() async {
        let model = model()
        await model.load()
        server.failsTrackerList = true
        await model.load()
        #expect(model.state.value?.count == 3)
        #expect(model.refreshFailure == "Please try again in a moment.")
    }

    @Test func aFailedLoadSaysSo() async {
        let model = model(signedIn: false)
        await model.load()
        #expect(model.state == .failed("Sign in again to see your paddles."))
    }
}
