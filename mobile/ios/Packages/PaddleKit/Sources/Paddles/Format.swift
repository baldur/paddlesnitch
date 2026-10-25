import Foundation
import PaddleAPI

/// How the site writes values, ported so the app reads the same: the web's
/// `fmtClock`, `split500`, `paddleKm` and `fmtWeekday` (packages/analysis,
/// packages/core). Pure, so every case is unit-tested.
public enum Format {
    static let dash = "—"

    /// A duration as a clock: 3896 → "1:04:56", 725 → "12:05".
    public static func clock(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let rest = String(format: "%02d", total % 60)
        return hours > 0 ? "\(hours):\(String(format: "%02d", minutes)):\(rest)" : "\(minutes):\(rest)"
    }

    /// JavaScript's `toFixed`: the double's exact decimal value, rounded half
    /// up. C's "%.2f" (and so `String(format:)`) rounds an exact tie to even
    /// instead: 0.25 is "0.3" on the web but "0.2" there.
    public static func fixed(_ value: Double, digits: Int) -> String {
        // A double's exact decimal expansion is finite; 60 places is far past
        // where a tie could hide for the values shown here.
        guard value.isFinite, var exact = Decimal(string: String(format: "%.60f", value), locale: posix) else {
            return String(value)
        }
        var rounded = Decimal()
        NSDecimalRound(&rounded, &exact, digits, .plain)  // half away from zero
        var text = NSDecimalNumber(decimal: rounded).description(withLocale: posix)
        if digits > 0 {
            if !text.contains(".") { text += "." }
            let have =
                text.count - (text.firstIndex(of: ".").map { text.distance(from: text.startIndex, to: $0) } ?? 0) - 1
            text += String(repeating: "0", count: max(0, digits - have))
        }
        return text
    }

    private static let posix = Locale(identifier: "en_US_POSIX")

    /// Minutes and seconds, minutes unbounded: 125 → "2:05". Rounds before
    /// splitting, so 119.6 is "2:00" (the web's `fmtDur` says "1:60").
    public static func minutesSeconds(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }

    /// Time per 500 m at a speed in m/s: 4 → "2:05". "—" when barely moving.
    public static func split500(speed: Double) -> String {
        speed > 0.2 ? minutesSeconds(500 / speed) : dash
    }

    /// "12.34 km", or "—" for a paddle with no GPS.
    public static func distance(km: Double, noGps: Bool = false) -> String {
        noGps ? dash : "\(fixed(km, digits: 2)) km"
    }

    /// "64 spm".
    public static func strokeRate(_ spm: Double) -> String {
        "\(Int(spm.rounded())) spm"
    }

    /// Metres per stroke to one decimal: "8.4 m".
    public static func perStroke(_ metres: Double) -> String {
        "\(fixed(metres, digits: 1)) m"
    }

    /// "11 km/h".
    public static func wind(kmh: Double) -> String {
        "\(Int(kmh.rounded())) km/h"
    }

    /// The direction wind blows from, to eight points: 225 → "SW".
    public static func compass(degrees: Double) -> String {
        let points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let index = Int((degrees / 45).rounded()) % 8
        return points[(index + 8) % 8]
    }

    /// River flow: "48.2 m³/s".
    public static func flow(m3s: Double) -> String {
        "\(fixed(m3s, digits: 1)) m³/s"
    }

    /// "Sun, 13 Sep 2026", in UTC like the web, so both say the same day.
    public static func weekday(_ date: Date) -> String {
        let parts = utc.dateComponents([.weekday, .day, .month, .year], from: date)
        let weekday = weekdays[(parts.weekday ?? 1) - 1]
        return "\(weekday), \(parts.day ?? 0) \(months[(parts.month ?? 1) - 1]) \(parts.year ?? 0)"
    }

    /// "Sep 2026", in UTC.
    public static func month(_ date: Date) -> String {
        let parts = utc.dateComponents([.month, .year], from: date)
        return "\(months[(parts.month ?? 1) - 1]) \(parts.year ?? 0)"
    }

    /// Where a paddle came from, as a card says it. A file says nothing.
    public static func source(_ type: AnalysisSource.Kind) -> String? {
        switch type {
        case .device: "Tracker"
        case .strava: "Strava"
        case .trial: "Time trial"
        case .file, .unknown: nil
        }
    }

    /// The same, from a card's plain `sourceType` string.
    public static func source(_ type: String) -> String? {
        source(AnalysisSource.Kind(rawValue: type))
    }

    /// The other source in "Also recorded by …".
    public static func alsoRecordedBy(_ type: String) -> String {
        switch AnalysisSource.Kind(rawValue: type) {
        case .strava: "Strava"
        case .trial: "a time trial"
        case .device: "the tracker"
        case .file, .unknown: "a file"
        }
    }

    /// A number as JavaScript prints it, for values the server already
    /// rounded: 0 → "0", 1.4 → "1.4", 12 → "12".
    public static func plain(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
    }

    /// About how many strokes, as the web's `roundStrokes`: to the hundred
    /// from 1,000, with commas. 12345 → "12,300".
    public static func strokes(_ count: Double) -> String {
        let near: (Double) -> Double = { $0.rounded(.toNearestOrAwayFromZero) }
        let rounded = Int(count >= 1000 ? near(count / 100) * 100 : near(count))
        return rounded.formatted(.number.locale(Locale(identifier: "en_US")))
    }

    /// Why a paddle has no route, as the web's paddle page says it.
    public static func noPaddleMessage(_ reason: NoPaddleReason, hasMotion: Bool) -> String {
        let motion = hasMotion ? " The boat motion was." : ""
        switch reason {
        case .noGps:
            return "The GPS never found the sky, so no route was recorded.\(motion)"
        case .gpsLost(let lost):
            return "The GPS lost the sky \(span(lost.lostAfterS)) after you set off, so no route was recorded"
                + " after that.\(motion)"
        case .tooShort(let short):
            return "Too short to be a paddle: the boat moved \(Int(short.movedM)) m, and a paddle needs"
                + " \(Int(short.minM)) m."
        case .unknown:
            return "No route was recorded for this paddle.\(motion)"
        }
    }

    static func span(_ seconds: Double) -> String {
        if seconds < 90 {
            let count = max(1, Int(seconds.rounded()))
            return count == 1 ? "1 second" : "\(count) seconds"
        }
        if seconds < 5400 { return "\(Int((seconds / 60).rounded())) minutes" }
        return "\(fixed(seconds / 3600, digits: 1)) hours"
    }

    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()
}
