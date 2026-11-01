import CryptoKit
import Foundation
import PaddleAPI

/// Not this time: the network, the server (5xx), or a file that can't be
/// read yet (locked phone). The queue tries again later, with backoff.
public struct TryLater: Error, Equatable {
    public let reason: String
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
    }

    /// One file's answer, in the README's terms.
    enum FileOutcome: Equatable {
        case sent, noPoints, removed, trackFirst, refused
    }

    static let pieceSize = 64 * 1024

    let client: PaddleClient
    let deviceID: String

    func send(_ recording: WaitingRecording) async throws -> Outcome {
        let manager = FileManager.default
        if manager.fileExists(atPath: recording.track.path(percentEncoded: false)) {
            switch try await sendFile(recording.track, as: recording.trackName) {
            case .sent:
                try? manager.removeItem(at: recording.track)
            case .noPoints:
                recording.deleteAll()
                return .noFix
            case .removed:
                return .removed
            case .trackFirst, .refused:
                return .refused
            }
        }
        if manager.fileExists(atPath: recording.motion.path(percentEncoded: false)) {
            switch try await sendFile(recording.motion, as: recording.motionName) {
            case .sent, .noPoints:
                try? manager.removeItem(at: recording.motion)
            case .removed:
                return .removed
            case .trackFirst:
                // Its track went first, in this pass or an earlier one: the
                // server hasn't caught up yet.
                throw TryLater(reason: "the server doesn't have the track of \(recording.stem) yet")
            case .refused:
                return .refused
            }
        }
        recording.deleteLogIfDone()
        return .sent
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
        }
        var queue = Self.order((1...count).filter { !held.contains($0) }, last: count)
        var mismatches = 0
        var gapRounds = 0
        while true {
            var next: [Int]?
            for number in queue {
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
                    mismatches += 1
                    // Once more from piece 1; a second mismatch is a dead end.
                    if mismatches > 1 { return .refused }
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
        case (400..<500, _): return .refused
        default: throw TryLater(reason: "the server answered \(answer.status)")
        }
    }
}
