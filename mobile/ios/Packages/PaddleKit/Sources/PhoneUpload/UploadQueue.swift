import Foundation
import Observation
import PaddleAPI
import Paddles

/// Uploads one account's recordings from this phone, oldest first, and says
/// on Paddles what's waiting (mobile/contract/README.md § Phone recording).
/// Never while a recording runs; again after a failure, with backoff; never
/// a file the server will never take.
@MainActor @Observable
public final class UploadQueue {
    /// One line on Paddles.
    public enum Line: Equatable, Identifiable, Sendable {
        /// Still to go: "Uploading…", or "Waiting to upload" while it can't.
        case waiting(stem: String, startedAt: Date?, uploading: Bool)
        /// The track had no GPS fix: gone, and this says so until dismissed.
        case noFix(stem: String, startedAt: Date?)
        /// The server will never take it: kept, with Report an issue.
        case refused(stem: String, startedAt: Date?)
        /// The owner removed this phone on Devices, with Add phone again;
        /// `waiting` recordings are kept until then.
        case removed(waiting: Int)
        /// Add phone again failed with no words from the server: the same
        /// button, to try again.
        case addFailed
        /// The server wouldn't add this phone (10 already): its words.
        case cannotAdd(String)

        public var id: String {
            switch self {
            case .waiting(let stem, _, _): "waiting-\(stem)"
            case .noFix(let stem, _): "nofix-\(stem)"
            case .refused(let stem, _): "refused-\(stem)"
            case .removed: "removed"
            case .addFailed: "add-failed"
            case .cannotAdd: "cannot-add"
            }
        }

        public var text: String {
            switch self {
            case .waiting(_, _, let uploading): uploading ? "Uploading…" : "Waiting to upload."
            case .noFix: "No GPS fix, so this didn’t become a paddle."
            case .refused: "Couldn’t upload this recording. It’s kept on this phone."
            case .removed(let waiting):
                "This phone was removed from your account. "
                    + (waiting == 1 ? "1 recording is waiting." : "\(waiting) recordings are waiting.")
            case .addFailed: "Couldn’t add this phone to your account. Tap Add phone again to try again."
            case .cannotAdd(let message): message
            }
        }

        /// When the recording started, "13 Sep 2026, 09:11" in the phone's
        /// time zone; none for the lines about the phone.
        public func started(in zone: TimeZone) -> String? {
            switch self {
            case .waiting(_, let date, _), .noFix(_, let date), .refused(_, let date):
                date.map { Format.dayTime($0, zone: zone) }
            case .removed, .addFailed, .cannotAdd: nil
            }
        }
    }

    public private(set) var lines: [Line] = []
    /// Set from the network's state: offline, recordings wait.
    public var online = true {
        didSet {
            guard online != oldValue else { return }
            if online { kick() }
            refreshLines()
        }
    }
    /// A recording is running: nothing uploads until it stops.
    public var recording = false {
        didSet {
            guard recording != oldValue else { return }
            if !recording { kick() }
            refreshLines()
        }
    }
    public private(set) var state: UploadState
    /// A file is going up now.
    public var isUploading: Bool { uploading != nil }

    let folder: URL
    let client: PaddleClient
    let installID: String
    let pause: @Sendable (Duration) async throws -> Void
    /// Whether a track is still being written (`RecordingFiles.isOpen`): it
    /// never goes, whatever `recording` says.
    let isOpen: @Sendable (URL) -> Bool
    private var stopped = false
    /// The server said the account was deleted (410): its recordings are
    /// gone from the phone and the queue has stopped; sign out, showing
    /// the server's words.
    public var accountDeleted: (@MainActor (String) -> Void)?
    /// Add phone again failed with no words from the server.
    private var addFailed = false
    private var uploading: String?
    private var failures = 0
    private var cannotAdd: String?
    private var loop: Task<Void, Never>?
    private var sleeper: Task<Void, any Error>?
    private var again = false

    /// - Parameters:
    ///   - folder: the signed-in account's recordings (`AccountModel.recordings(for:)`).
    ///   - pause: waits between passes; tests make it instant.
    public init(
        folder: URL, client: PaddleClient, installID: String,
        pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        isOpen: @escaping @Sendable (URL) -> Bool = { _ in false }
    ) {
        self.folder = folder
        self.client = client
        self.installID = installID
        self.pause = pause
        self.isOpen = isOpen
        state = UploadState.load(from: folder)
        refreshLines()
    }

    /// Starts uploading in the background of the app.
    public func start() {
        guard loop == nil else { return }
        loop = Task { await run() }
    }

    /// Stops it (signed out). The files stay.
    public func stop() {
        stopped = true
        loop?.cancel()
        sleeper?.cancel()
        loop = nil
    }

    /// Look again now: a recording stopped, the app came back, the network did.
    public func kick() {
        again = true
        sleeper?.cancel()
    }

    /// After every sign-in: the same phone for the same account and install.
    /// Not if the owner removed it: that waits for Upload now or Start.
    public func signedIn() async {
        guard !state.removed else { return }
        _ = try? await addPhone()
    }

    /// Upload now, or Start after the phone was removed: adds it again, then
    /// uploads what's waiting.
    public func addAgain() async {
        do {
            try await addPhone()
        } catch PaddleAPIError.rejected {
            return  // the server's words are on the line (`cannotAdd`)
        } catch {
            addFailed = true
            refreshLines()
            return
        }
        addFailed = false
        state.removed = false
        save()
        refreshLines()
        kick()
    }

    /// Closes a "No GPS fix" line, or a "Couldn’t upload" one (its files
    /// stay on the phone, never retried).
    public func dismiss(_ stem: String) {
        state.noFix.removeAll { $0 == stem }
        if state.refused.contains(stem) && !state.dismissed.contains(stem) { state.dismissed.append(stem) }
        save()
        refreshLines()
    }

    @discardableResult
    func addPhone() async throws -> String {
        do {
            let phone = try await client.addPhone(installID: installID)
            guard !stopped else { throw CancellationError() }
            state.deviceID = phone.deviceId
            cannotAdd = nil
            save()
            refreshLines()
            return phone.deviceId
        } catch PaddleAPIError.accountDeleted(let message) {
            deleteAccountsRecordings(message)
            throw CancellationError()
        } catch PaddleAPIError.rejected(let message, let status, _) where status == 400 || status == 409 {
            cannotAdd = message
            refreshLines()
            throw PaddleAPIError.rejected(message: message, status: status, session: nil)
        }
    }

    private func run() async {
        while !Task.isCancelled {
            again = false
            let wait = await pass()
            if again { continue }
            let sleeper = Task { try await pause(wait) }
            self.sleeper = sleeper
            _ = try? await sleeper.value
        }
    }

    /// Long enough to mean "until something changes".
    static let idle = Duration.seconds(3600)

    /// One pass through what's waiting. Returns how long to wait before
    /// the next.
    @discardableResult
    func pass() async -> Duration {
        defer { refreshLines() }
        let waiting = WaitingRecording.all(in: folder).filter { !state.refused.contains($0.stem) && !isOpen($0.track) }
        guard !recording, online, !state.removed, cannotAdd == nil, !waiting.isEmpty else { return Self.idle }
        do {
            var deviceID = state.deviceID ?? ""
            if deviceID.isEmpty { deviceID = try await addPhone() }
            let mismatched = Mismatches(state.mismatched)
            defer {
                state.mismatched = mismatched.all
                save()
            }
            try await send(waiting, with: RecordingSender(client: client, deviceID: deviceID, mismatched: mismatched))
            failures = 0
            return Self.idle
        } catch PaddleAPIError.signedOut {
            uploading = nil
            return Self.idle
        } catch let PaddleAPIError.rejected(_, status, _) where status == 400 || status == 409 {
            uploading = nil  // couldn't add the phone: the line says why
            return Self.idle
        } catch let wait as TryLater {
            uploading = nil
            failures += 1
            return wait.after ?? Self.backoff(failures)
        } catch {
            uploading = nil
            failures += 1
            return Self.backoff(failures)
        }
    }

    /// Sends each in turn, oldest first, until a recording starts or the
    /// phone turns out to be removed.
    private func send(_ waiting: [WaitingRecording], with sender: RecordingSender) async throws {
        for recording in waiting {
            guard !self.recording, !Task.isCancelled else { return }
            uploading = recording.stem
            refreshLines()
            let outcome = try await sender.send(recording)
            uploading = nil
            guard !stopped else { return }
            switch outcome {
            case .sent: break
            case .noFix: state.noFix.append(recording.stem)
            case .refused: state.refused.append(recording.stem)
            case .removed: state.removed = true
            case .accountDeleted(let message):
                deleteAccountsRecordings(message)
                return
            }
            save()
            if state.removed { return }
        }
    }

    /// 5 s, 10 s, 20 s … up to 5 minutes.
    static func backoff(_ failures: Int) -> Duration {
        .seconds(min(300, 5 << min(failures - 1, 6)))
    }

    /// 410: the account no longer exists. Never upload its recordings:
    /// delete them all, stop, and say so (the app signs out).
    private func deleteAccountsRecordings(_ message: String) {
        stop()
        try? FileManager.default.removeItem(at: folder)
        state = UploadState()
        lines = []
        accountDeleted?(message)
    }

    /// Not once stopped: a queue of an account signed out of (or deleted)
    /// writes nothing more.
    private func save() {
        guard !stopped else { return }
        try? state.save(to: folder)
    }

    private func refreshLines() {
        let all = WaitingRecording.all(in: folder)
        var lines: [Line] = []
        if let cannotAdd { lines.append(.cannotAdd(cannotAdd)) }
        let waiting = all.filter { !state.refused.contains($0.stem) }
        if addFailed && state.removed && !waiting.isEmpty {
            lines.append(.addFailed)
        } else if state.removed && !waiting.isEmpty {
            lines.append(.removed(waiting: waiting.count))
        } else {
            // "Uploading…" for the one going up now; the rest wait.
            lines += waiting.map {
                .waiting(stem: $0.stem, startedAt: $0.startedAt, uploading: uploading == $0.stem)
            }
        }
        lines += all.filter { state.refused.contains($0.stem) && !state.dismissed.contains($0.stem) }
            .map { .refused(stem: $0.stem, startedAt: $0.startedAt) }
        lines += state.noFix.map {
            .noFix(stem: $0, startedAt: WaitingRecording(stem: $0, folder: folder).startedAt)
        }
        if lines != self.lines { self.lines = lines }
    }
}
