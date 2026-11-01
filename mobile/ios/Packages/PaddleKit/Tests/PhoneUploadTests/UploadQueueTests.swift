import Foundation
import PaddleAPI
import Testing

@testable import PhoneUpload

/// The queue's own rules: the phone on the account, when it uploads, and in
/// what order.
@MainActor
struct UploadQueueTests {
    let server = FakeUploadServer()

    func queue(_ folder: URL) -> UploadQueue {
        UploadQueue(folder: folder, client: client(server), installID: "install-0123456789abcdef", pause: { _ in })
    }

    @Test func aRemovedPhoneStopsAndKeepsTheFilesUntilUploadNow() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        await queue.signedIn()
        server.phoneRemoved = true
        await queue.pass()
        #expect(names(in: folder).count == 4)
        #expect(queue.lines == [.removed])
        #expect(queue.lines[0].text == "This phone was removed from your account")
        // Not added again in the background, nor at the next sign-in.
        let phoneCalls = server.phoneCalls
        await queue.pass()
        await queue.signedIn()
        #expect(server.phoneCalls == phoneCalls)
        // Upload now adds it again, then what's waiting goes.
        await queue.addAgain()
        #expect(server.phoneCalls == phoneCalls + 1)
        #expect(!queue.state.removed)
        await queue.pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func tenPhonesAlreadySaysTheServersWords() async throws {
        let folder = try folder()
        try record(in: folder)
        server.phoneAnswer = (409, fixture("account.phone.too-many"))
        let queue = queue(folder)
        await queue.pass()
        #expect(server.uploads.isEmpty)
        #expect(
            queue.lines.first?.text
                == "Couldn't add this phone: your account has 10 already. Remove one on Devices, then try again.")
    }

    @Test func nothingUploadsWhileARecordingRuns() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        queue.recording = true
        await queue.pass()
        #expect(server.uploads.isEmpty)
        #expect(queue.lines.map(\.text) == ["Waiting to upload"])
        queue.recording = false
        await queue.pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func offlineItWaits() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        queue.online = false
        await queue.pass()
        #expect(server.calls.isEmpty)
        #expect(queue.lines.map(\.text) == ["Waiting to upload"])
        queue.online = true
        // "Uploading…" only while it's the one going up.
        #expect(queue.lines.map(\.text) == ["Waiting to upload"])
    }

    @Test func theRawIMUFileIsNeverSent() async throws {
        let folder = try folder()
        try record(in: folder)
        try Data("raw".utf8).write(to: folder.appending(path: "track_20261101_070211_imu.csv"))
        await queue(folder).pass()
        #expect(server.uploads.count == 2)
        #expect(server.files["track_20261101_070211_imu.csv"] != Data("raw".utf8))
    }

    @Test func oldestFirstAndASameSecondRecordingKeepsItsName() async throws {
        let folder = try folder()
        try record("track_20261101_090000", in: folder, motionBytes: nil)
        try record("track_20261101_070211_1", in: folder, motionBytes: nil)
        try record("track_20261101_070211", in: folder)
        await queue(folder).pass()
        #expect(
            server.uploads.map { $0.query["filename"] } == [
                "track_20261101_070211.csv", "track_20261101_070211_imu.csv", "track_20261101_070211_1.csv",
                "track_20261101_090000.csv",
            ])
    }

    @Test func thePhoneIsAddedOnceAndRemembered() async throws {
        let folder = try folder()
        try record(in: folder)
        let first = queue(folder)
        await first.signedIn()
        #expect(server.calls.first?.body == Data(#"{"installId":"install-0123456789abcdef","model":"phone-ios"}"#.utf8))
        try record("track_20261101_090000", in: folder)
        await queue(folder).pass()
        #expect(server.phoneCalls == 1)
    }

    @Test func signedOutNothingIsSentAndNothingIsLost() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = UploadQueue(
            folder: folder, client: client(server, signedIn: false), installID: "install-0123456789abcdef",
            pause: { _ in })
        #expect(await queue.pass() == UploadQueue.idle)
        #expect(server.calls.isEmpty)
        #expect(names(in: folder).count == 3)
    }

    /// The loop on its own: idle until kicked (a recording stopped), then
    /// what's waiting goes.
    @Test func aKickWakesTheQueue() async throws {
        let folder = try folder()
        let queue = UploadQueue(
            folder: folder, client: client(server), installID: "install-0123456789abcdef",
            pause: { try await Task.sleep(for: $0) })
        queue.start()
        defer { queue.stop() }
        try await Task.sleep(for: .milliseconds(100))
        try record(in: folder)
        queue.kick()
        for _ in 0..<100 where names(in: folder) != ["uploads.json"] {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(names(in: folder) == ["uploads.json"])
    }

    /// The #767 debug build wrote recordings to the same folder, with no
    /// uploads.json: a build installed over it shows them waiting at once
    /// and uploads them, the drop log going with them.
    @Test func recordingsFromAnEarlierBuildAreUploaded() async throws {
        let folder = try folder()
        try record("track_20261101_070211", in: folder)
        try record("track_20261101_070211_1", in: folder)
        #expect(!names(in: folder).contains("uploads.json"))
        let queue = queue(folder)
        #expect(queue.lines.map(\.id) == ["waiting-track_20261101_070211", "waiting-track_20261101_070211_1"])
        await queue.signedIn()
        await queue.pass()
        #expect(server.uploads.count == 4)
        #expect(names(in: folder) == ["uploads.json"])
        #expect(queue.lines.isEmpty)
    }

    @Test func theInstallIDIsMadeOnceAndFitsTheServersRule() throws {
        let defaults = try #require(UserDefaults(suiteName: "install-\(UUID().uuidString)"))
        let id = InstallID.current(in: defaults)
        #expect(id.count == 32)
        #expect(InstallID.valid(id))
        #expect(InstallID.current(in: defaults) == id)
        #expect(!InstallID.valid("short"))
        #expect(!InstallID.valid("has a space in it, so it's not one"))
    }
}
