import Foundation
import PaddleAPI

/// Boat motion's words and axes, as the website's (format.json:
/// `fmtEvenness`, `axisTicks`, `envelopeXLabels`, `noMotionCopy`).
extension Format {
    /// "6%": how uneven the roll is, by JavaScript's toFixed (0.5 rounds up).
    public static func evenness(_ imbalancePct: Double) -> String {
        fixed(abs(imbalancePct), digits: 0) + "%"
    }

    /// The y-axis ticks for a chart bound: every 2° up to 6°, 3° up to 12°,
    /// then 5°, symmetric about 0 and inside the bound.
    public static func axisTicks(_ maxDeg: Double) -> [Double] {
        let step: Double = maxDeg > 12 ? 5 : maxDeg > 6 ? 3 : 2
        let top = (maxDeg / step).rounded(.down) * step
        return stride(from: -top, through: top, by: step).map { $0 == 0 ? 0 : $0 }
    }

    /// "Through the session"'s x labels for a recording `ms` long: seconds
    /// under two minutes (a 20 s recording read "0 min … 0 min"), else minutes.
    public static func envelopeXLabels(_ ms: Double) -> (String, String) {
        ms < 120_000
            ? ("0 s", "\(Int((ms / 1000).rounded())) s")
            : ("0 min", "\(Int((ms / 60_000).rounded())) min")
    }

    /// Why there are no charts. A `reason` means motion data arrived but
    /// couldn't be measured (the reason itself is for engineers, never
    /// shown); none means it hasn't arrived yet.
    public static func noMotionCopy(reason: String?) -> String {
        if let reason, !reason.isEmpty {
            return "We couldn’t measure boat motion in this recording. "
                + "The tracker or phone may not have been fixed firmly in the boat."
        }
        return "Motion data uploads after the GPS track. If this recording is recent, it may still be uploading. "
            + "Older recordings have no motion data."
    }
}
