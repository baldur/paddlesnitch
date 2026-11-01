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
        /// The owner removed this phone on Devices, with Upload now.
        case removed
        /// The server wouldn't add this phone (10 already): its words.
        case cannotAdd(String)

        public var id: String {
            switch self {
            case .waiting(let stem, _, _): "waiting-\(stem)"
            case .noFix(let stem, _): "nofix-\(stem)"
            case .refused(let stem, _): "refused-\(stem)"
            case .removed: "removed"
            case .cannotAdd: "cannot-add"
            }
        }

        public var text: String {
            switch self {
            case .waiting(_, _, let uploading): uploading ? "Uploading…" : "Waiting to upload"
            case .noFix: "No GPS fix, so this didn't become a paddle"
            case .refused: "Couldn't upload this recording. It's kept on this phone."
            case .removed: "This phone was removed from your account"
            case .cannotAdd(let message): message
            }
        }

        /// When the recording started, "13 Sep 2026, 09:11" in the phone's
        /// time zone; none for the lines about the phone.
        public func started(in zone: TimeZone) -> String? {
            switch self {
            case .waiting(_, let date, _), .noFix(_, let date), .refused(_, let date):
                date.map { Format.dayTime($0, zone: zone) }
            case .removed, .cannotAdd: nil
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
        pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.folder = folder
        self.client = client
        self.installID = installID
        self.pause = pause
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
        guard (try? await addPhone()) != nil else { return }
        state.removed = false
        save()
        kick()
    }

    /// Closes a "No GPS fix" line.
    public func dismiss(_ stem: String) {
        state.noFix.removeAll { $0 == stem }
        save()
        refreshLines()
    }

    @discardableResult
    func addPhone() async throws -> String {
        do {
            let phone = try await client.addPhone(installID: installID)
            state.deviceID = phone.deviceId
            cannotAdd = nil
            save()
            refreshLines()
            return phone.deviceId
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
        let waiting = WaitingRecording.all(in: folder).filter { !state.refused.contains($0.stem) }
        guard !recording, online, !state.removed, cannotAdd == nil, !waiting.isEmpty else { return Self.idle }
        do {
            var deviceID = state.deviceID ?? ""
            if deviceID.isEmpty { deviceID = try await addPhone() }
            try await send(waiting, with: RecordingSender(client: client, deviceID: deviceID))
            failures = 0
            return Self.idle
        } catch PaddleAPIError.signedOut {
            uploading = nil
            return Self.idle
        } catch let PaddleAPIError.rejected(_, status, _) where status == 400 || status == 409 {
            uploading = nil  // couldn't add the phone: the line says why
            return Self.idle
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
            switch outcome {
            case .sent: break
            case .noFix: state.noFix.append(recording.stem)
            case .refused: state.refused.append(recording.stem)
            case .removed: state.removed = true
            }
            save()
            if state.removed { return }
        }
    }

    /// 5 s, 10 s, 20 s … up to 5 minutes.
    static func backoff(_ failures: Int) -> Duration {
        .seconds(min(300, 5 << min(failures - 1, 6)))
    }

    private func save() {
        try? state.save(to: folder)
    }

    private func refreshLines() {
        let all = WaitingRecording.all(in: folder)
        var lines: [Line] = []
        if let cannotAdd { lines.append(.cannotAdd(cannotAdd)) }
        let waiting = all.filter { !state.refused.contains($0.stem) }
        if state.removed && !waiting.isEmpty {
            lines.append(.removed)
        } else {
            let canGo = online && !recording && failures == 0 && cannotAdd == nil
            lines += waiting.map {
                .waiting(stem: $0.stem, startedAt: $0.startedAt, uploading: canGo || uploading == $0.stem)
            }
        }
        lines += all.filter { state.refused.contains($0.stem) }.map { .refused(stem: $0.stem, startedAt: $0.startedAt) }
        lines += state.noFix.map {
            .noFix(stem: $0, startedAt: WaitingRecording(stem: $0, folder: folder).startedAt)
        }
        if lines != self.lines { self.lines = lines }
    }
}
