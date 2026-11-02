import Foundation

/// The status line under the motion trace, in the words agreed for both apps
/// (mobile/contract/README.md § Motion line).
public struct MotionLine: Equatable, Sendable {
    public static let noSamples = "Couldn’t read the motion sensor. Stroke rate pauses until it’s back."
    public static let back = "Motion sensor back"

    public let text: String
    /// Red only when the sensor can't be read; muted otherwise.
    public let isWarning: Bool

    public init(_ status: MotionTrace.Status) {
        switch status {
        case .starting: (text, isWarning) = ("Starting motion sensor", false)
        case .motion: (text, isWarning) = ("Motion sensor working", false)
        case .still: (text, isWarning) = ("Motion sensor working, phone still", false)
        case .noSamples: (text, isWarning) = (Self.noSamples, true)
        }
    }

    /// Said once on entering `noSamples` and once on leaving it; nothing
    /// otherwise (the line isn't a live region).
    public static func announcement(before: MotionTrace?, now: MotionTrace?) -> String? {
        guard let now else { return nil }
        switch (before?.status == .noSamples, now.status == .noSamples) {
        case (false, true): return noSamples
        case (true, false): return back
        default: return nil
        }
    }
}
