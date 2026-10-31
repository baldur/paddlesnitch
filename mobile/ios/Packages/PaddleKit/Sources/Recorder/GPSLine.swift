import Foundation

/// The recording screen's GPS line, from the recorder core's `fix` and
/// `since_fix_s`, in the words agreed for both apps (lead with copy-style;
/// the Phone recording section of mobile/contract, #761).
public struct GPSLine: Equatable, Sendable {
    public enum State: Equatable, Sendable { case waiting, fix, lost }

    public let state: State
    /// What the screen shows: "GPS lost 40 s ago".
    public let text: String
    /// What VoiceOver reads: "GPS lost 40 seconds ago".
    public let label: String

    public init(_ live: LiveValues) {
        guard let since = live.secondsSinceFix else {
            (state, text, label) = (.waiting, "Waiting for GPS", "Waiting for GPS")
            return
        }
        if live.hasFix {
            (state, text, label) = (.fix, "GPS fix", "GPS fix")
        } else if since < 1 {
            (state, text, label) = (.lost, "GPS lost", "GPS lost")
        } else if since < 60 {
            let s = Int(since)
            (state, text, label) = (.lost, "GPS lost \(s) s ago", "GPS lost \(s) \(s == 1 ? "second" : "seconds") ago")
        } else {
            // Whole minutes, rounded down, past an hour too: 2 min, 75 min.
            let m = Int(since / 60)
            (state, text, label) = (
                .lost, "GPS lost \(m) min ago", "GPS lost \(m) \(m == 1 ? "minute" : "minutes") ago"
            )
        }
    }

    /// Said once when the GPS state changes: "GPS lost" when a fix goes,
    /// "GPS back" when it returns after a loss. Nothing for the first fix,
    /// and nothing while the time since grows.
    public static func announcement(before: LiveValues, now: LiveValues) -> String? {
        switch (GPSLine(before).state, GPSLine(now).state) {
        case (.fix, .lost): "GPS lost"
        case (.lost, .fix): "GPS back"
        default: nil
        }
    }
}
