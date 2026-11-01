import Foundation

/// A recording on this phone that the server doesn't have yet: its track,
/// its motion file, or both (the track went, the motion file is still to go).
public struct WaitingRecording: Equatable, Sendable, Identifiable {
    /// `track_20260918_062422`, or `track_20260918_062422_1` for a second
    /// recording in the same second.
    public let stem: String
    public let folder: URL

    public var id: String { stem }
    public var track: URL { folder.appending(path: "\(stem).csv") }
    /// The core's 10 Hz motion file, `<stem>_i10.csv`.
    public var motion: URL { folder.appending(path: "\(stem)_i10.csv") }
    public var log: URL { folder.appending(path: "\(stem).log") }
    public var trackName: String { "\(stem).csv" }
    /// The motion file goes up as `<stem>_imu.csv`, the tracker's name for it
    /// (firmware/src/naming.cpp).
    public var motionName: String { "\(stem)_imu.csv" }

    /// When it started, from its name (UTC, as the tracker names files).
    public var startedAt: Date? {
        let digits = stem.dropFirst("track_".count).prefix(15)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter.date(from: String(digits))
    }

    /// Every recording in `folder` with a file still to send, oldest first.
    /// A raw `_imu.csv` (kept only while debugging) is never sent.
    public static func all(in folder: URL) -> [WaitingRecording] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []
        var stems = Set<String>()
        for name in names where name.hasPrefix("track_") && name.hasSuffix(".csv") && !name.hasSuffix("_imu.csv") {
            stems.insert(
                name.hasSuffix("_i10.csv") ? String(name.dropLast("_i10.csv".count)) : String(name.dropLast(4)))
        }
        return stems.sorted().map { WaitingRecording(stem: $0, folder: folder) }
    }

    /// Deletes what's left of it: the files, and the drop log with them.
    func deleteAll() {
        for file in [track, motion, log] { try? FileManager.default.removeItem(at: file) }
    }

    /// The log goes once both files have.
    func deleteLogIfDone() {
        let manager = FileManager.default
        if !manager.fileExists(atPath: track.path(percentEncoded: false))
            && !manager.fileExists(atPath: motion.path(percentEncoded: false))
        {
            try? manager.removeItem(at: log)
        }
    }
}
