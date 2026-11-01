import Foundation
import PaddleAPI
import Testing

@testable import PhoneUpload

/// The edges: a sign-in that expires mid-upload, the network going, a file
/// still being written or unreadable, pieces that keep going missing, a
/// phone removed half-way, and a queue stopped or an account deleted.
@MainActor
struct UploadEdgeTests {
    let server = FakeUploadServer()

    func queue(_ folder: URL, isOpen: @escaping @Sendable (URL) -> Bool = { _ in false }) -> UploadQueue {
        UploadQueue(
            folder: folder, client: client(server), installID: "install-0123456789abcdef", pause: { _ in },
            isOpen: isOpen)
    }

    @Test func anExpiredSignInIsRefreshedAndTheUploadGoesOn() async throws {
        let folder = try folder()
        try record(in: folder)
        server.refusesToken = "id-token"
        await queue(folder).pass()
        #expect(server.files.count == 2)
        #expect(server.uploads.last?.authorization == "Bearer fresh-token")
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func aSignInRefusedTwiceKeepsTheFilesAndNeverMarksThemRefused() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        await queue.signedIn()
        // The fresh token is refused too: signed out, not "never take it".
        server.refusesToken = "id-token"
        server.answers["track_20261101_070211.csv"] = [(401, Data())]
        #expect(await queue.pass() == UploadQueue.idle)
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
        #expect(queue.state.refused.isEmpty)
        #expect(queue.lines.map(\.text) == ["Waiting to upload"])
    }

    @Test func noNetworkMidFileWaitsAndKeepsTheFiles() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        await queue.signedIn()
        server.networkFailures = 1
        #expect(await queue.pass() == .seconds(5))
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
        #expect(queue.lines.map(\.text) == ["Waiting to upload"])
        await queue.pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func aFileThatCantBeReadYetWaits() async throws {
        let folder = try folder()
        try record(in: folder)
        let track = folder.appending(path: "track_20261101_070211.csv")
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: track.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: track.path) }
        let queue = queue(folder)
        #expect(await queue.pass() == .seconds(5))
        #expect(server.uploads.isEmpty)
        #expect(queue.state.refused.isEmpty)
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
    }

    /// The recording still being written never goes, even if the queue was
    /// made after it started (a sign-in mid-recording) and hasn't heard.
    @Test func aTrackStillBeingWrittenIsNeverSent() async throws {
        let folder = try folder()
        try record("track_20261101_070211", in: folder)
        try record("track_20261101_090000", in: folder)
        let queue = queue(folder) { $0.lastPathComponent == "track_20261101_090000.csv" }
        await queue.pass()
        #expect(
            server.uploads.map { $0.query["filename"] } == [
                "track_20261101_070211.csv", "track_20261101_070211_imu.csv",
            ])
        #expect(names(in: folder).contains("track_20261101_090000.csv"))
    }

    @Test func piecesThatKeepGoingMissingAreTriedAgainLater() async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: 64 * 1024 * 2 + 1, motionBytes: nil)
        let gap = (409, Data(#"{"error":"parts_missing","missing":[2],"parts":3}"#.utf8))
        server.answers["track_20261101_070211.csv"] = [(202, Data()), (202, Data())] + Array(repeating: gap, count: 5)
        let queue = queue(folder)
        #expect(await queue.pass() == .seconds(5))
        #expect(queue.state.refused.isEmpty)
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
    }

    @Test func aRemovedPhoneFoundByTheHeldPiecesStops() async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: 64 * 1024 + 1, motionBytes: nil)
        let queue = queue(folder)
        await queue.signedIn()
        server.phoneRemoved = true
        await queue.pass()
        #expect(server.calls.last?.method == "GET")
        #expect(queue.state.removed)
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
    }

    @Test func aPhoneRemovedBetweenTheTrackAndTheMotionFileKeepsTheMotionFile() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211_imu.csv"] = [(404, fixture("account.phone-upload.not-found"))]
        let queue = queue(folder)
        await queue.pass()
        #expect(names(in: folder) == ["track_20261101_070211.log", "track_20261101_070211_i10.csv", "uploads.json"])
        #expect(queue.state.removed)
        #expect(queue.lines == [.removed])
    }

    /// "Once" across passes: a mismatch, a server failure, then a second
    /// mismatch is a dead end, not a fresh start.
    @Test func aSecondShaMismatchInALaterPassIsADeadEnd() async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: 64 * 1024 + 1, motionBytes: nil)
        let mismatch = (422, Data(#"{"error":"sha256_mismatch"}"#.utf8))
        server.answers["track_20261101_070211.csv"] = [(202, Data()), mismatch, (202, Data()), (503, Data())]
        let queue = queue(folder)
        #expect(await queue.pass() == .seconds(5))
        #expect(UploadState.load(from: folder).mismatched == ["track_20261101_070211.csv"])
        server.answers["track_20261101_070211.csv"] = [(202, Data()), mismatch]
        await queue.pass()
        #expect(queue.state.refused == ["track_20261101_070211"])
    }

    /// Signed out (or deleted) part-way: the old queue writes nothing more.
    @Test func aStoppedQueueWritesNothing() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        queue.stop()
        await queue.signedIn()
        #expect(!names(in: folder).contains("uploads.json"))
    }

    @Test func anAccountsDeletedFolderIsNeverBroughtBack() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = queue(folder)
        try FileManager.default.removeItem(at: folder)
        await queue.signedIn()
        await queue.dismiss("track_20261101_070211")
        #expect(!FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)))
    }

    @Test func theStateIsLeftOutOfBackups() async throws {
        let folder = try folder()
        try record(in: folder)
        await queue(folder).signedIn()
        let values = try folder.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(values.isExcludedFromBackup == true)
        #expect(UploadState.load(from: folder).deviceID == "P3F2A9C41B7E0D865")
    }

    /// On the loop, not by hand: the network coming back, and a recording
    /// stopping, each send what's waiting.
    @Test func theNetworkComingBackAndStopSendWhatsWaiting() async throws {
        let folder = try folder()
        try record(in: folder)
        let queue = UploadQueue(
            folder: folder, client: client(server), installID: "install-0123456789abcdef",
            pause: { try await Task.sleep(for: $0) })
        queue.online = false
        queue.start()
        defer { queue.stop() }
        try await Task.sleep(for: .milliseconds(100))
        #expect(server.uploads.isEmpty)
        queue.online = true
        #expect(try await gone(folder))
        try record("track_20261101_090000", in: folder)
        queue.recording = true
        try await Task.sleep(for: .milliseconds(100))
        #expect(names(in: folder).contains("track_20261101_090000.csv"))
        queue.recording = false
        #expect(try await gone(folder))
    }

    /// 410: the account was deleted (on the website). Its recordings must
    /// never upload: the folder goes, the queue stops, and the app signs out.
    @Test(arguments: ["upload", "phone", "held"])
    func aDeletedAccountsRecordingsAreDeletedNotUploaded(_ answeredBy: String) async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: answeredBy == "held" ? 64 * 1024 + 1 : 300)
        let gone = (410, Data(#"{"error":"This account was deleted.","accountDeleted":true}"#.utf8))
        switch answeredBy {
        case "phone": server.phoneAnswer = gone
        case "held": server.heldAnswer = gone
        default: server.answers["*"] = [gone]
        }
        let queue = queue(folder)
        var signedOut = false
        queue.accountDeleted = { signedOut = true }
        await queue.pass()
        #expect(signedOut)
        #expect(!FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)))
        #expect(server.files.isEmpty)
        #expect(queue.lines.isEmpty)
        await queue.pass()
        #expect(!FileManager.default.fileExists(atPath: folder.path(percentEncoded: false)))
    }

    private func gone(_ folder: URL) async throws -> Bool {
        for _ in 0..<100 where names(in: folder) != ["uploads.json"] {
            try await Task.sleep(for: .milliseconds(20))
        }
        return names(in: folder) == ["uploads.json"]
    }
}
