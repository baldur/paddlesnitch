import Foundation

/// A recording's files, named as the tracker names its own:
/// `track_<stamp>.csv` and `track_<stamp>_i10.csv`, the stamp being the start
/// in UTC (`20260918_061002`). Every line goes to the system as it's written,
/// so a killed app loses nothing it had.
///
/// Like `PhoneRecorder`, it's used from the recorder's one queue.
public final class RecordingFiles: RecordingSink {
    public let track: URL
    public let motion: URL
    /// The drop counts, written by `close(droppedLate:droppedUnpaired:)`.
    public let log: URL
    /// The first write that failed (a full phone); later lines are skipped.
    public private(set) var failure: Error?
    /// Lines that couldn't be written: the failed one and every one after.
    public private(set) var failedLines = 0

    private let trackHandle: FileHandle
    private let motionHandle: FileHandle

    /// A second recording started in the same second becomes
    /// `track_<stamp>_1`, `_2` and so on, the tracker's rule
    /// (firmware/src/storage.cpp), so the server sees one naming scheme.
    public init(directory: URL, start: Date) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Self.excludeFromBackup(directory)
        let base = "track_" + Self.stamp(start)
        var stem = base
        for i in 1..<100 where FileManager.default.fileExists(atPath: directory.appending(path: stem + ".csv").path) {
            stem = "\(base)_\(i)"
        }
        track = directory.appending(path: stem + ".csv")
        motion = directory.appending(path: stem + "_i10.csv")
        log = directory.appending(path: stem + ".log")
        trackHandle = try Self.create(track)
        motionHandle = try Self.create(motion)
        Self.open.withLock { _ = $0.insert(track.standardizedFileURL.path) }
    }

    private static let open = OpenTracks()

    /// Whether `track` is a recording still being written: never upload it.
    public static func isOpen(_ track: URL) -> Bool {
        open.withLock { $0.contains(track.standardizedFileURL.path) }
    }

    public func write(_ line: Data, to stream: RecordingStream) {
        // Not kept: the server rebuilds stroke rate from the two files.
        guard stream != .stroke else { return }
        guard failure == nil else {
            failedLines += 1
            return
        }
        do {
            switch stream {
            case .track: try trackHandle.write(contentsOf: line)
            case .motion: try motionHandle.write(contentsOf: line)
            case .stroke: break
            }
        } catch {
            failure = error
            failedLines += 1
        }
    }

    /// Call after `PhoneRecorder.finish()`. The counts go in `log`, three
    /// lines as Android writes them: a rising drop count means events were
    /// held too long or a sensor stopped; failed lines, that the phone was full.
    public func close(droppedLate: UInt32, droppedUnpaired: UInt32) throws {
        defer { Self.open.withLock { _ = $0.remove(track.standardizedFileURL.path) } }
        try trackHandle.close()
        try motionHandle.close()
        let text =
            "dropped_late,\(droppedLate)\ndropped_unpaired,\(droppedUnpaired)\nfailed_lines,\(failedLines)\n"
        try Data(text.utf8).write(to: log, options: Self.logOptions)
    }

    static func stamp(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        func two(_ value: Int?) -> String { String(format: "%02d", value ?? 0) }
        return String(format: "%04d", c.year ?? 0) + two(c.month) + two(c.day) + "_" + two(c.hour)
            + two(c.minute) + two(c.second)
    }

    /// A precise track shows where someone paddles from: encrypted while the
    /// phone is locked, except that a file already open stays writable (not
    /// `.complete`, which would stop the recording seconds after the screen
    /// locks). macOS, where the package tests run, has no such classes.
    #if os(iOS)
        static var protection: [FileAttributeKey: Any]? { [.protectionKey: FileProtectionType.completeUnlessOpen] }
        static let logOptions: Data.WritingOptions = [.atomic, .completeFileProtectionUnlessOpen]
    #else
        static var protection: [FileAttributeKey: Any]? { nil }
        static let logOptions: Data.WritingOptions = [.atomic]
    #endif

    /// Ends a recording: what the layer still holds is written, then the
    /// files are closed with its drop counts. In that order, or the held
    /// rows are lost.
    public func finish(_ recorder: PhoneRecorder) throws {
        recorder.finish()
        try close(droppedLate: recorder.droppedLate, droppedUnpaired: recorder.droppedUnpaired)
    }

    /// Not in iCloud or computer backups: a track shows where someone
    /// paddles from (lead, #761, as Android's allowBackup=false). Until
    /// upload (C3) a recording lost with the phone is the accepted cost.
    static func excludeFromBackup(_ directory: URL) throws {
        var folder = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
    }

    private static func create(_ url: URL) throws -> FileHandle {
        // Never over an earlier recording.
        guard !FileManager.default.fileExists(atPath: url.path) else {
            throw CocoaError(.fileWriteFileExists, userInfo: [NSFilePathErrorKey: url.path])
        }
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: Self.protection) else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path])
        }
        return try FileHandle(forWritingTo: url)
    }
}

/// The tracks being written now, across recordings (iOS 17 has no Mutex).
private final class OpenTracks: @unchecked Sendable {
    private let lock = NSLock()
    private var paths = Set<String>()

    func withLock<T>(_ body: (inout Set<String>) -> T) -> T {
        lock.withLock { body(&paths) }
    }
}
