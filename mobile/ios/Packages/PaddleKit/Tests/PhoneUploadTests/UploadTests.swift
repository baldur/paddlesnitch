import CryptoKit
import Foundation
import PaddleAPI
import Testing

@testable import PhoneUpload

/// Uploading the phone's recordings (mobile/contract/README.md § Phone
/// recording): the order, the pieces, and what each answer in the README's
/// table does to the files and to the lines on Paddles.
@MainActor
struct UploadTests {
    let server = FakeUploadServer()

    func queue(_ folder: URL, server: FakeUploadServer? = nil) -> UploadQueue {
        UploadQueue(
            folder: folder, client: client(server ?? self.server), installID: "install-0123456789abcdef",
            pause: { _ in })
    }

    @Test func theTrackGoesFirstThenTheMotionFileUnderTheTrackersName() async throws {
        let folder = try folder()
        let (track, motion) = try record(in: folder)
        let queue = queue(folder)
        #expect(await queue.pass() == UploadQueue.idle)
        #expect(server.phoneCalls == 1)
        #expect(
            server.uploads.map { $0.query["filename"] } == [
                "track_20261101_070211.csv", "track_20261101_070211_imu.csv",
            ])
        #expect(server.uploads.allSatisfy { $0.path == "/api/account/devices/P3F2A9C41B7E0D865/sessions" })
        #expect(server.uploads.allSatisfy { $0.contentType == "application/octet-stream" })
        #expect(server.uploads.allSatisfy { $0.authorization == "Bearer id-token" })
        #expect(server.files["track_20261101_070211.csv"] == track)
        #expect(server.files["track_20261101_070211_imu.csv"] == motion)
        // Sent, so the phone's copy goes, and its log with it.
        #expect(names(in: folder) == ["uploads.json"])
        #expect(queue.lines.isEmpty)
        #expect(queue.state.deviceID == "P3F2A9C41B7E0D865")
    }

    @Test func aFileOf64KBOrMoreGoesInPiecesWithTheWholeFilesSha() async throws {
        let folder = try folder()
        let size = 64 * 1024 * 2 + 10
        let (track, _) = try record(in: folder, trackBytes: size, motionBytes: nil)
        await queue(folder).pass()
        let pieces = server.uploads
        #expect(pieces.map { $0.query["part"] } == ["1", "2", "3"])
        #expect(pieces.allSatisfy { $0.query["parts"] == "3" })
        let sha = SHA256.hash(data: track).map { String(format: "%02x", $0) }.joined()
        #expect(pieces.allSatisfy { $0.query["sha256"] == sha })
        #expect(pieces.map(\.body.count) == [65_536, 65_536, 10])
        #expect(server.files["track_20261101_070211.csv"] == track)
    }

    @Test func aFileJustUnder64KBGoesWhole() async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: 64 * 1024 - 1, motionBytes: nil)
        await queue(folder).pass()
        #expect(server.uploads.count == 1, "\(server.calls.map { "\($0.method) \($0.path) \($0.query)" })")
        #expect(server.uploads.first?.query["part"] == nil)
    }

    @Test func piecesTheServerAlreadyHoldsArentSentAgain() async throws {
        let folder = try folder()
        let (track, _) = try record(in: folder, trackBytes: 64 * 1024 * 3 + 1, motionBytes: nil)
        server.held["track_20261101_070211.csv"] = [
            1: track.subdata(in: 0..<65_536), 2: track.subdata(in: 65_536..<131_072),
        ]
        await queue(folder).pass()
        #expect(server.calls.contains { $0.method == "GET" && $0.query["filename"] == "track_20261101_070211.csv" })
        #expect(server.uploads.map { $0.query["part"] } == ["3", "4"])
        #expect(server.files["track_20261101_070211.csv"] == track)
    }

    @Test func missingPiecesAreSentAgainThenTheLast() async throws {
        let folder = try folder()
        let (track, _) = try record(in: folder, trackBytes: 64 * 1024 * 2 + 1, motionBytes: nil)
        server.lose = [2]
        await queue(folder).pass()
        #expect(server.uploads.map { $0.query["part"] } == ["1", "2", "3", "2", "3"])
        #expect(server.files["track_20261101_070211.csv"] == track)
    }

    @Test func aShaMismatchSendsTheWholeFileOnceMore() async throws {
        let folder = try folder()
        let (track, _) = try record(in: folder, trackBytes: 64 * 1024 + 1, motionBytes: nil)
        server.answers["track_20261101_070211.csv"] = [
            (202, Data()), (422, Data(#"{"error":"sha256_mismatch"}"#.utf8)),
        ]
        await queue(folder).pass()
        #expect(server.uploads.map { $0.query["part"] } == ["1", "2", "1", "2"])
        #expect(server.files["track_20261101_070211.csv"] == track)
    }

    @Test func aSecondShaMismatchIsADeadEndAndTheFileIsKept() async throws {
        let folder = try folder()
        try record(in: folder, trackBytes: 64 * 1024 + 1)
        let mismatch = (422, Data(#"{"error":"sha256_mismatch"}"#.utf8))
        server.answers["track_20261101_070211.csv"] = [(202, Data()), mismatch, (202, Data()), mismatch]
        let queue = queue(folder)
        await queue.pass()
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
        #expect(names(in: folder).contains("track_20261101_070211_i10.csv"))
        #expect(queue.lines.map(\.text) == ["Couldn’t upload this recording. It’s kept on this phone."])
        // Never retried by itself.
        let sent = server.uploads.count
        await queue.pass()
        #expect(server.uploads.count == sent)
    }

    @Test func alreadyUploadedCountsAsSent() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211.csv"] = [(409, fixture("account.phone-upload.already-uploaded"))]
        await queue(folder).pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func noGPSFixDeletesBothFilesAndSaysSoUntilDismissed() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211.csv"] = [(422, fixture("account.phone-upload.no-points"))]
        let queue = queue(folder)
        await queue.pass()
        #expect(server.uploads.count == 1)  // the motion file isn't sent
        #expect(names(in: folder) == ["uploads.json"])
        let line = try #require(queue.lines.first)
        #expect(line.text == "No GPS fix, so this didn’t become a paddle.")
        #expect(line.started(in: .gmt) == "1 Nov 2026, 07:02")
        queue.dismiss("track_20261101_070211")
        #expect(queue.lines.isEmpty)
        #expect(UploadState.load(from: folder).noFix.isEmpty)
    }

    @Test func anEmptyMotionFileCountsAsSent() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211_imu.csv"] = [(422, Data(#"{"error":"no_motion_rows"}"#.utf8))]
        await queue(folder).pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func aMotionFileBeforeItsTrackIsTriedAgainLater() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211_imu.csv"] = [(409, fixture("account.phone-upload.track-not-uploaded"))]
        let queue = queue(folder)
        #expect(await queue.pass() == .seconds(5))
        #expect(names(in: folder).contains("track_20261101_070211_i10.csv"))
        #expect(!names(in: folder).contains("track_20261101_070211.csv"))
        await queue.pass()
        #expect(names(in: folder) == ["uploads.json"])
    }

    @Test func anyOther4xxKeepsTheFileAndStops() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["track_20261101_070211.csv"] = [(413, Data(#"{"error":"too_large"}"#.utf8))]
        let queue = queue(folder)
        await queue.pass()
        #expect(names(in: folder).contains("track_20261101_070211.csv"))
        #expect(queue.state.refused == ["track_20261101_070211"])
        #expect(queue.lines.map(\.id) == ["refused-track_20261101_070211"])
    }

    @Test func aServerFailureWaitsLongerEachTimeAndKeepsTheFiles() async throws {
        let folder = try folder()
        try record(in: folder)
        server.answers["*"] = [(500, Data()), (502, Data()), (503, Data())]
        let queue = queue(folder)
        #expect(await queue.pass() == .seconds(5))
        #expect(queue.lines.map(\.text) == ["Waiting to upload."])
        #expect(await queue.pass() == .seconds(10))
        #expect(await queue.pass() == .seconds(20))
        #expect(names(in: folder).count == 4)
        #expect(await queue.pass() == UploadQueue.idle)
        #expect(names(in: folder) == ["uploads.json"])
        #expect(UploadQueue.backoff(30) == .seconds(300))
    }
}
