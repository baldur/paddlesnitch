import CryptoKit
import Foundation
import PaddleAPI

/// Not this time: the network, the server (5xx), or a file that can't be
/// read yet (locked phone). The queue tries again later, with backoff.
public struct TryLater: Error, Equatable {
    public let reason: String
    /// How long the server asked to wait (`Retry-After`), if it did.
    public var after: Duration?

    public init(reason: String, after: Duration? = nil) {
        self.reason = reason
        self.after = after
    }
}

/// Sends one recording as mobile/contract/README.md § Phone recording says:
/// the track first, then the motion file under the tracker's name, in 64 KB
/// pieces like the tracker, and acts on each answer as the README's table
/// does.
struct RecordingSender {
    enum Outcome: Equatable {
        /// Both files are on the server (or counted as sent) and deleted here.
        case sent
        /// The track had no GPS fix at all: deleted, and the line says so.
        case noFix
        /// This phone isn't on the account any more (404). Files kept.
        case removed
        /// The server will never take it. Files kept.
        case refused
        /// 410 with `accountDeleted`: the account was deleted (on the
        /// website, say). Its recordings must never upload: the queue deletes
        /// them and signs out, showing the server's words.
        case accountDeleted(String)
    }

    /// One file's answer, in the README's terms.
    enum FileOutcome: Equatable {
        case sent, noPoints, removed, trackFirst, refused
        case accountDeleted(String)
    }

    static let pieceSize = 64 * 1024

    let client: PaddleClient
    let deviceID: String
    /// Files with one sha256 mismatch already; a second gives up on it.
    let mismatched: Mismatches

    func send(_ recording: WaitingRecording) async throws -> Outcome {
        if let stop = try await sendTrack(of: recording) { return stop }
        if let stop = try await sendMotion(of: recording) { return stop }
        recording.deleteLogIfDone()
        return .sent
    }

    /// The track, if it's still here. An outcome means stop with it.
    private func sendTrack(of recording: WaitingRecording) async throws -> Outcome? {
        guard FileManager.default.fileExists(atPath: recording.track.path(percentEncoded: false)) else { return nil }
        switch try await sendFile(recording.track, as: recording.trackName) {
        case .sent:
            try? FileManager.default.removeItem(at: recording.track)
            return nil
        case .noPoints:
            recording.deleteAll()
            return .noFix
        case .removed: return .removed
        case .accountDeleted(let message): return .accountDeleted(message)
        case .trackFirst, .refused: return .refused
        }
    }

    /// The motion file, if it's still here, after its track.
    private func sendMotion(of recording: WaitingRecording) async throws -> Outcome? {
        guard FileManager.default.fileExists(atPath: recording.motion.path(percentEncoded: false)) else { return nil }
        switch try await sendFile(recording.motion, as: recording.motionName) {
        case .sent, .noPoints:
            try? FileManager.default.removeItem(at: recording.motion)
            return nil
        case .removed: return .removed
        case .accountDeleted(let message): return .accountDeleted(message)
        case .trackFirst:
            // Its track went first, in this pass or an earlier one: the
            // server hasn't caught up yet.
            throw TryLater(reason: "the server doesn't have the track of \(recording.stem) yet")
        case .refused: return .refused
        }
    }

    func sendFile(_ url: URL, as name: String) async throws -> FileOutcome {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            // Encrypted while the phone is locked: readable after unlock.
            throw TryLater(reason: "can't read \(name) yet")
        }
        if data.count < Self.pieceSize {
            return try outcome(
                of: try await client.uploadRecording(
                    deviceID: deviceID, filename: name, body: data, piece: nil))
        }
        return try await sendInPieces(data, as: name)
    }

    private func sendInPieces(_ data: Data, as name: String) async throws -> FileOutcome {
        let count = (data.count + Self.pieceSize - 1) / Self.pieceSize
        let sha = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let held: Set<Int>
        do {
            held = Set(try await client.heldParts(deviceID: deviceID, filename: name))
        } catch PaddleAPIError.rejected(_, let status, _) where status == 404 {
            return .removed
        } catch PaddleAPIError.accountDeleted(let message) {
            return .accountDeleted(message)
        }
        var queue = Self.order((1...count).filter { !held.contains($0) }, last: count)
        var gapRounds = 0
        while true {
            var next: [Int]?
            for number in queue {
                // Stopped (signed out): not another piece.
                try Task.checkCancellation()
                let start = (number - 1) * Self.pieceSize
                let piece = data.subdata(in: start..<min(start + Self.pieceSize, data.count))
                let answer = try await client.uploadRecording(
                    deviceID: deviceID, filename: name, body: piece,
                    piece: UploadPiece(number: number, of: count, sha256: sha))
                if answer.status == 202 { continue }
                if answer.status == 409 && answer.error == "parts_missing" {
                    gapRounds += 1
                    if gapRounds > 3 { throw TryLater(reason: "pieces of \(name) keep going missing") }
                    next = Self.order(answer.missing, last: count)
                    break
                }
                if answer.status == 422 && answer.error == "sha256_mismatch" {
                    // Once more from piece 1; a second mismatch is a dead end.
                    if mismatched.contains(name) { return .refused }
                    mismatched.insert(name)
                    next = Array(1...count)
                    break
                }
                return try outcome(of: answer)
            }
            guard let next else { throw TryLater(reason: "no answer for the last piece of \(name)") }
            queue = next
        }
    }

    /// The pieces to send, the last one last (it's the one that puts the file
    /// together), and always the last.
    static func order(_ pieces: [Int], last: Int) -> [Int] {
        Array(Set(pieces).subtracting([last])).sorted() + [last]
    }

    /// The README's table, for a whole file or the last piece.
    func outcome(of answer: UploadAnswer) throws -> FileOutcome {
        switch (answer.status, answer.error) {
        case (201, _), (200, _), (409, "already_uploaded"): return .sent
        case (422, "no_points"): return .noPoints
        case (422, "no_motion_rows"): return .sent
        case (409, "track_not_uploaded"): return .trackFirst
        case (404, _): return .removed
        // A 410 without the flag isn't ours (a proxy): try again later.
        case (410, let error) where answer.accountDeleted: return .accountDeleted(error ?? "")
        case (410, _): throw TryLater(reason: "the server answered 410")
        // The account is being deleted, or the server is busy.
        case (503, _):
            throw TryLater(reason: "the server is busy", after: answer.retryAfter.map { .seconds($0) })
        case (400..<500, _): return .refused
        default: throw TryLater(reason: "the server answered \(answer.status)")
        }
    }
}

/// The files that have had a sha256 mismatch, kept by the queue across passes.
final class Mismatches: @unchecked Sendable {
    private let lock = NSLock()
    private var names: Set<String>

    init(_ names: [String]) {
        self.names = Set(names)
    }

    var all: [String] { lock.withLock { names.sorted() } }
    func contains(_ name: String) -> Bool { lock.withLock { names.contains(name) } }
    func insert(_ name: String) { _ = lock.withLock { names.insert(name) } }
}
