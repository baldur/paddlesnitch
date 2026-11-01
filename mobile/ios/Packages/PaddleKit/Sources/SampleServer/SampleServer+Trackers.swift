import Foundation
import PaddleAPI

/// The trackers' routes, from the account.devices* fixtures; a removed
/// tracker stays as a summary with linked false, as the server keeps one
/// that has recordings.
extension SampleServer {
    /// Make removing a tracker fail, as when the server is down.
    public var failsTrackerRemoval: Bool {
        get { lock.withLock { _failsTrackerRemoval } }
        set { lock.withLock { _failsTrackerRemoval = newValue } }
    }

    /// Make the trackers' list or their recordings fail, as when the server
    /// is down.
    public var failsTrackerList: Bool {
        get { lock.withLock { _failsTrackerList } }
        set { lock.withLock { _failsTrackerList = newValue } }
    }

    public var failsTrackerRecordings: Bool {
        get { lock.withLock { _failsTrackerRecordings } }
        set { lock.withLock { _failsTrackerRecordings = newValue } }
    }

    func trackers(path: String, request: URLRequest) throws -> (Int, Data) {
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true else {
            return (401, try fixture("account.error"))
        }
        switch (request.httpMethod ?? "GET", path) {
        case ("GET", "/api/account/devices") where failsTrackerList,
            ("GET", "/api/account/devices/sessions") where failsTrackerRecordings:
            return (502, Data("<html>Bad gateway</html>".utf8))
        case ("GET", "/api/account/devices"):
            // The server lists this phone too since C3; the app leaves it out.
            var list = try JSONDecoder.paddlesnitch.decode(
                TrackerList.self, from: try fixture("account.devices.with-phone"))
            let removed = lock.withLock { _removedTrackers }
            list.devices.removeAll { removed.contains($0.deviceId) }
            list.summaries = list.summaries.map { summary in
                var summary = summary
                if removed.contains(summary.deviceId) { summary.linked = false }
                return summary
            }
            return (200, try JSONEncoder.paddlesnitch.encode(list))
        case ("GET", "/api/account/devices/sessions"):
            // A recording that became a paddle opens one of the samples.
            var list = try JSONDecoder.paddlesnitch.decode(
                RecordingList.self, from: try fixture("account.devices-sessions"))
            list.sessions = list.sessions.map { recording in
                var recording = recording
                if recording.paddleId != nil { recording.paddleId = "pdl-river" }
                return recording
            }
            return (200, try JSONEncoder.paddlesnitch.encode(list))
        case ("DELETE", "/api/account/devices"):
            if lock.withLock({ _failsTrackerRemoval }) { return (502, Data("<html>Bad gateway</html>".utf8)) }
            let id = try JSONDecoder().decode(TrackerId.self, from: request.httpBody ?? Data()).deviceId
            _ = lock.withLock { _removedTrackers.insert(id) }
            return (200, Data(#"{"ok":true}"#.utf8))
        default:
            return (404, Data(#"{"error":"Not found"}"#.utf8))
        }
    }
}
