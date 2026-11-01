import Foundation
import PaddleAPI

/// One tracker card, as the website's /devices draws it. The verdicts
/// (firmware state, quiet, a recent crash) and the counts are the server's
/// (`TrackerSummary`); this only writes them out.
public struct TrackerCard: Identifiable, Hashable, Sendable {
    /// The colour a piece of a line is drawn in.
    public enum Tone: Hashable, Sendable {
        case muted, fg, split, green, red
    }

    /// A piece of a line, with its colour.
    public struct Part: Hashable, Sendable {
        public let text: String
        public let tone: Tone
    }

    public struct Line: Hashable, Sendable {
        public let parts: [Part]
        public var text: String { parts.map(\.text).joined() }
    }

    public let id: String
    public let name: String
    /// Removed from the account, kept for its recordings.
    public let removed: Bool
    /// "firmware 0.19.3 · beta · up to date · seen 4h ago · crashed …";
    /// none for a removed tracker.
    public let status: Line?
    /// "12 recordings · 84.21 km · 9 with boat motion · latest 24 Oct 2026"
    public let recordings: String
    /// "C0FFEE01 · tbeam-s3-supreme": for support, so last and small.
    public let identity: String
    /// What VoiceOver reads: a sentence, times spelled out, without the id.
    public let spoken: String

    /// The cards, in the server's order. Trackers only: a phone (C3), or a
    /// kind this app doesn't know, is never drawn as a tracker. No kind is a
    /// tracker (servers before C3).
    public static func cards(from list: TrackerList, now: Date) -> [TrackerCard] {
        list.summaries.filter { ($0.kind ?? .tracker) == .tracker }.map { summary in
            TrackerCard(
                summary: summary, tracker: list.devices.first { $0.deviceId == summary.deviceId },
                stable: list.stableVersion, now: now)
        }
    }

    public init(summary: TrackerSummary, tracker: Tracker?, stable: String?, now: Date) {
        id = summary.deviceId
        name = summary.name
        removed = !summary.linked
        let status = summary.linked ? Self.status(summary, tracker, stable: stable, now: now) : nil
        self.status = status
        recordings = Self.recordings(summary)
        identity = tracker.map { "\(summary.deviceId) · \($0.model)" } ?? summary.deviceId
        let said =
            [summary.name] + (summary.linked ? [] : ["removed"])
            + (status.map { Self.spoken($0.text, summary, tracker, now: now) } ?? [])
            + recordings.components(separatedBy: " · ")
        spoken = said.joined(separator: ", ")
    }

    /// The status line as words: the written times ("4d ago") spelled out.
    private static func spoken(_ line: String, _ summary: TrackerSummary, _ tracker: Tracker?, now: Date) -> [String] {
        var text = line
        if let seen = tracker?.lastSeenAt {
            text = text.replacingOccurrences(
                of: "seen \(Format.ago(seen, now: now))", with: "seen \(spokenAgo(seen, now))")
        }
        if let crash = summary.crash {
            text = text.replacingOccurrences(
                of: "crashed \(Format.ago(crash.at, now: now))", with: "crashed \(spokenAgo(crash.at, now))")
        }
        return text.components(separatedBy: " · ")
    }

    static func spokenAgo(_ date: Date, _ now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date).rounded(.down)))
        let (count, unit): (Int, String) =
            seconds < 90
            ? (seconds, "second")
            : seconds / 60 < 90
                ? (seconds / 60, "minute")
                : seconds / 3600 < 48 ? (seconds / 3600, "hour") : (seconds / 86_400, "day")
        return "\(count) \(unit)\(count == 1 ? "" : "s") ago"
    }

    private static func status(_ summary: TrackerSummary, _ tracker: Tracker?, stable: String?, now: Date) -> Line {
        var parts = [Part(text: "firmware ", tone: .muted), Part(text: tracker?.firmware ?? "unknown", tone: .fg)]
        if tracker?.beta == true { parts.append(Part(text: " · beta", tone: .split)) }
        switch summary.firmwareState {
        case .updatePending:
            let target = tracker?.targetVersion ?? stable
            parts.append(Part(text: " · update pending" + (target.map { " (\($0))" } ?? ""), tone: .split))
        case .upToDate:
            parts.append(Part(text: " · up to date", tone: .green))
        case .unknown, .unrecognised:
            break
        }
        parts.append(Part(text: " · seen ", tone: .muted))
        parts.append(Part(text: Format.ago(tracker?.lastSeenAt, now: now), tone: summary.quiet ? .red : .fg))
        // In words too, not by colour alone.
        if summary.quiet { parts.append(Part(text: " · quiet", tone: .red)) }
        if let crash = summary.crash {
            let task = crash.task.isEmpty ? "" : " (\(crash.task))"
            parts.append(Part(text: " · crashed \(Format.ago(crash.at, now: now))\(task)", tone: .red))
        }
        return Line(parts: parts)
    }

    private static func recordings(_ summary: TrackerSummary) -> String {
        guard summary.recordings > 0 else { return "no recordings yet" }
        var text = summary.recordings == 1 ? "1 recording" : "\(summary.recordings) recordings"
        if summary.distanceMetres > 0 { text += " · \(Format.distance(metres: Double(summary.distanceMetres)))" }
        if summary.motionRecordings > 0 { text += " · \(summary.motionRecordings) with boat motion" }
        if let latest = summary.latestAt { text += " · latest \(Format.day(latest))" }
        return text
    }
}

/// One of a tracker's recordings, as the website's tracker page lists it.
public struct RecordingRow: Identifiable, Hashable, Sendable {
    public let id: String
    /// "25 Oct 2026, 07:02 · 8.24 km", in the viewer's zone.
    public let title: String
    /// "paddle · with boat motion", or "not a paddle · <file>".
    public let detail: String
    /// The paddle it became, to open; none for a desk test or no fix.
    public let paddleID: String?

    /// This tracker's recordings, in the server's order (newest upload first).
    public static func rows(from recordings: [Recording], deviceId: String, zone: TimeZone) -> [RecordingRow] {
        recordings.filter { $0.deviceId == deviceId }.map { RecordingRow($0, zone: zone) }
    }

    init(_ recording: Recording, zone: TimeZone) {
        id = recording.sessionId
        var title = Format.dayTime(recording.startedAt ?? recording.uploadedAt, zone: zone)
        if let metres = recording.distanceMetres, metres > 0 { title += " · \(Format.distance(metres: metres))" }
        self.title = title
        paddleID = recording.paddleId
        detail =
            recording.paddleId != nil
            ? "paddle" + (recording.motion != nil ? " · with boat motion" : "")
            : "not a paddle · \(recording.filename)"
    }
}

/// Where the trackers screen gets its data: the account's /api/account/devices
/// calls (mobile/contract/README.md, Account).
public protocol TrackersSource: Sendable {
    func list() async throws -> TrackerList
    func recordings() async throws -> [Recording]
    func remove(_ deviceId: String) async throws
}

public struct ServerTrackers: TrackersSource {
    let client: PaddleClient

    public init(client: PaddleClient) {
        self.client = client
    }

    public func list() async throws -> TrackerList {
        try await client.send(Endpoints.getAccountDevices, NoInput())
    }

    public func recordings() async throws -> [Recording] {
        try await client.send(Endpoints.getAccountDevicesSessions, NoInput()).sessions
    }

    public func remove(_ deviceId: String) async throws {
        _ = try await client.send(Endpoints.deleteAccountDevices, TrackerId(deviceId: deviceId))
    }
}

/// The trackers screen and each tracker's page: the cards, their
/// recordings, and removing a tracker.
@MainActor @Observable
public final class TrackersModel {
    public private(set) var state: Loadable<[TrackerCard]> = .loading
    /// Loaded apart from the cards: a failure here leaves the cards.
    public private(set) var recordingsState: Loadable<[Recording]> = .loading
    /// A refresh failed with the cards still showing.
    public private(set) var refreshFailure: String?
    private let source: any TrackersSource
    private let now: @Sendable () -> Date
    private let zone: TimeZone

    public init(source: any TrackersSource, now: @escaping @Sendable () -> Date = Date.init, zone: TimeZone = .current)
    {
        self.source = source
        self.now = now
        self.zone = zone
    }

    public func load() async {
        async let recordings: Void = loadRecordings()
        do {
            state = .loaded(TrackerCard.cards(from: try await source.list(), now: now()))
            refreshFailure = nil
        } catch {
            if state.value == nil {
                state = .failed(FailureMessage.of(error))
            } else {
                refreshFailure = FailureMessage.of(error)
            }
        }
        await recordings
    }

    public func loadRecordings() async {
        do {
            recordingsState = .loaded(try await source.recordings())
        } catch {
            if recordingsState.value == nil { recordingsState = .failed(FailureMessage.of(error)) }
        }
    }

    public func card(_ deviceId: String) -> TrackerCard? {
        state.value?.first { $0.id == deviceId }
    }

    /// This tracker's recordings; nil until they've loaded.
    public func recordings(of deviceId: String) -> [RecordingRow]? {
        recordingsState.value.map { RecordingRow.rows(from: $0, deviceId: deviceId, zone: zone) }
    }

    /// Removes a tracker; its recordings and paddles stay. Nil when done,
    /// else what to say.
    public func remove(_ deviceId: String) async -> String? {
        do {
            try await source.remove(deviceId)
            await load()
            return nil
        } catch {
            return "Couldn’t remove the tracker. Please try again."
        }
    }
}
