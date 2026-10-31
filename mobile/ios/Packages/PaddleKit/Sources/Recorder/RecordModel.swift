import Foundation
import Observation

/// A recording in progress, as the screen sees it.
public protocol RecordingHandle: AnyObject, Sendable {
    /// Writes what's held and closes the files.
    func stop() throws
}

/// The record screen's state. The numbers on it come from the recorder core
/// (`LiveValues`); nil shows "—".
@MainActor @Observable
public final class RecordModel {
    public enum Phase: Equatable {
        case ready
        case recording
        /// Saved on the phone, under this file name.
        case saved(String)
    }

    /// Starts a recording; its status arrives on the main actor.
    public typealias Start =
        @MainActor (_ onStatus: @escaping @MainActor @Sendable (RecordingStatus) -> Void) throws
        -> (handle: RecordingHandle, name: String)

    public private(set) var phase: Phase = .ready
    public private(set) var status = RecordingStatus()
    /// "Couldn't …" for the screen, or nil.
    public private(set) var problem: String?
    /// When this recording started, for the elapsed time.
    public private(set) var startedAt: Date?

    private let start: Start
    private let now: () -> Date
    private var handle: RecordingHandle?
    private var name = ""

    public init(now: @escaping () -> Date = Date.init, start: @escaping Start) {
        self.now = now
        self.start = start
    }

    public func record() {
        guard phase != .recording else { return }
        problem = nil
        status = RecordingStatus()
        do {
            let started = try start { [weak self] status in self?.update(status) }
            handle = started.handle
            name = started.name
            startedAt = now()
            phase = .recording
        } catch {
            problem = "Couldn't start recording. Please try again."
        }
    }

    public func stop() {
        guard let handle else { return }
        self.handle = nil
        do {
            try handle.stop()
        } catch {
            problem = "Couldn't finish saving the recording. What was recorded so far is kept."
        }
        phase = .saved(name)
    }

    /// Back to the start, for another recording.
    public func done() {
        guard handle == nil else { return }
        phase = .ready
        problem = nil
    }

    private func update(_ status: RecordingStatus) {
        guard handle != nil else { return }
        self.status = status
        if status.couldNotSave {
            problem = "Couldn't save the recording. Your iPhone may be full."
        }
    }
}

/// What the screen shows while recording, sent after each second's row.
public struct RecordingStatus: Sendable, Equatable {
    /// The last row had a usable fix.
    public var hasFix = false
    public var live = LiveValues()
    public var droppedLate: UInt32 = 0
    public var droppedUnpaired: UInt32 = 0
    /// A write failed; the rest of the recording is lost.
    public var couldNotSave = false

    public init(
        hasFix: Bool = false, live: LiveValues = LiveValues(), droppedLate: UInt32 = 0, droppedUnpaired: UInt32 = 0,
        couldNotSave: Bool = false
    ) {
        self.hasFix = hasFix
        self.live = live
        self.droppedLate = droppedLate
        self.droppedUnpaired = droppedUnpaired
        self.couldNotSave = couldNotSave
    }
}
