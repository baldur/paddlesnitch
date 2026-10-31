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
    /// Whether the last row the core wrote had a usable fix (its `fix`
    /// column), so the screen says what the file says.
    public private(set) var lastRowHasFix = false

    private let trackHandle: FileHandle
    private let motionHandle: FileHandle

    public init(directory: URL, start: Date) throws {
        let stem = "track_" + Self.stamp(start)
        track = directory.appending(path: stem + ".csv")
        motion = directory.appending(path: stem + "_i10.csv")
        log = directory.appending(path: stem + ".log")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        trackHandle = try Self.create(track)
        motionHandle = try Self.create(motion)
    }

    public func write(_ line: Data, to stream: RecordingStream) {
        guard failure == nil else { return }
        do {
            switch stream {
            case .track:
                lastRowHasFix =
                    line.split(separator: UInt8(ascii: ","), omittingEmptySubsequences: false)
                    .dropFirst(4).first == Data("1".utf8)
                try trackHandle.write(contentsOf: line)
            case .motion: try motionHandle.write(contentsOf: line)
            }
        } catch {
            failure = error
        }
    }

    /// Call after `PhoneRecorder.finish()`. The counts go in `log`: a rising
    /// count means events were held too long or a sensor stopped.
    public func close(droppedLate: UInt32, droppedUnpaired: UInt32) throws {
        try trackHandle.close()
        try motionHandle.close()
        let text = "dropped_late,\(droppedLate)\ndropped_unpaired,\(droppedUnpaired)\n"
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
