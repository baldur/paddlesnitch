import Foundation
import Observation
import PaddleAPI

/// A paddle's recording, for its Boat motion screen (mobile/contract/
/// README.md, "Boat motion"): offered only on your own paddle from a
/// tracker or phone, with both ids.
public struct MotionRecording: Hashable, Sendable {
    public let deviceId: String
    public let sessionId: String
    /// A phone's recording: "Open phone" instead of "Open tracker".
    public let phone: Bool
    /// The paddle's own stroke rate, for its tile.
    public let strokeRate: Double?
    public let paddledAt: Date

    public init?(_ paddle: AnalysisSession) {
        guard paddle.source.type == .device, let deviceId = paddle.source.deviceId,
            let sessionId = paddle.source.deviceSessionId
        else { return nil }
        self.deviceId = deviceId
        self.sessionId = sessionId
        phone = paddle.source.phone == true
        strokeRate = paddle.result.avgSR
        paddledAt = paddle.paddledAt
    }
}

/// The Boat motion screen.
@MainActor @Observable
public final class BoatMotionModel {
    public enum State: Equatable, Sendable {
        case loading
        /// "Couldn’t read this recording." with Try again.
        case failed
        /// 404: "We can't find this recording", no Try again.
        case notFound
        case noMotion(NoMotion)
        case loaded(BoatMotionSummary)
    }

    public struct NoMotion: Equatable, Sendable {
        /// `noMotionCopy`: the file hasn't arrived, or couldn't be measured.
        public let copy: String
        /// Where the file could be synced from, when it hasn't arrived.
        public let open: Device?
    }

    public enum Device: Equatable, Sendable {
        case tracker, phone

        /// "Open tracker" or "Open phone".
        public var button: String { self == .phone ? "Open phone" : "Open tracker" }
    }

    public typealias Fetch = @Sendable (_ etag: String?) async throws -> PaddleClient.Conditional<RecordingMotion>

    public private(set) var state: State = .loading
    /// How many loads in a row have failed: from the second, accessibility
    /// focus goes back to the error.
    public private(set) var failures = 0
    /// From the second failure in a row, focus goes back to the error.
    public var focusError: Bool { failures >= 2 }
    public let recording: MotionRecording
    private let fetch: Fetch
    private var etag: String?
    private var shown: RecordingMotion?

    public init(recording: MotionRecording, fetch: @escaping Fetch) {
        self.recording = recording
        self.fetch = fetch
    }

    /// Loads, or tries again. A 304 keeps what's on screen.
    public func load() async {
        if shown == nil { state = .loading }
        do {
            switch try await fetch(etag) {
            case .changed(let motion, let tag):
                etag = tag
                shown = motion
            case .unchanged:
                break
            }
            failures = 0
            guard let shown else { throw PaddleAPIError.badResponse(status: 304) }
            show(shown)
        } catch PaddleAPIError.rejected(_, 404, _) {
            failures = 0
            state = .notFound
        } catch {
            failures += 1
            state = .failed
        }
    }

    private func show(_ motion: RecordingMotion) {
        guard let attitude = motion.attitude, attitude.available else {
            let reason = motion.attitude?.reason
            let arrived = !(reason ?? "").isEmpty
            state = .noMotion(
                NoMotion(
                    copy: Format.noMotionCopy(reason: reason),
                    open: arrived ? nil : recording.phone ? .phone : .tracker))
            return
        }
        state = .loaded(BoatMotionSummary(attitude, strokeRate: recording.strokeRate))
    }
}

/// Everything the screen draws, worked out from the server's numbers as
/// the README says. Pure, so it's tested without a screen.
public struct BoatMotionSummary: Hashable, Sendable {
    public struct Tile: Hashable, Sendable {
        public let label: String
        public let value: String
        public let note: String?
        /// Read as one element: "°" as "degrees", "spm" as "strokes per minute".
        public let spoken: String
    }

    /// A value across a chart: `x` from 0 to 1, angles in degrees.
    public struct Point: Hashable, Sendable {
        public let x: Double
        public let value: Double
    }

    public struct Band: Hashable, Sendable {
        public let x: Double
        public let rollMin, rollMax, pitchMin, pitchMax: Double
    }

    /// One y gridline: its value and "-6°".
    public struct Tick: Hashable, Sendable {
        public let value: Double
        public let label: String
    }

    /// "Through the session".
    public struct Envelope: Hashable, Sendable {
        /// ± this many degrees; values beyond are clamped to it.
        public let bound: Double
        public let ticks: [Tick]
        /// Empty with fewer than 2 points: the panel stays, the chart doesn't.
        public let bands: [Band]
        /// The start and the end ("0 min", "42 min"); none without a chart.
        public let xLabels: [String]
        /// "A few moments went past ±11° and are clipped at the chart’s edge."
        public let clippedNote: String?
        public let spoken: String
    }

    /// "Stroke shape".
    public struct Excerpt: Hashable, Sendable {
        public let bound: Double
        public let ticks: [Tick]
        public let roll: [Point]
        public let pitch: [Point]
        /// "30 s at 10 Hz"
        public let xLabel: String?
    }

    /// "Where the boat spent its time".
    public struct Histogram: Hashable, Sendable {
        /// The x range is ±this many degrees.
        public let halfRange: Double
        /// Bars by centre, in degrees, and count.
        public let bars: [RollHistogram.Bin]
        /// The same counts flipped about 0: the bin nearest -centre.
        public let mirrored: [RollHistogram.Bin]
        /// 0.86 of a bin, in degrees.
        public let barWidth: Double
        public let maxCount: Int
        /// "−11°" (U+2212) and "+11°".
        public let leftLabel, rightLabel: String
    }

    public let tiles: [Tile]
    public let envelope: Envelope
    public let excerpt: Excerpt
    /// Nil without bins: the panel stays, the chart doesn't.
    public let histogram: Histogram?
    /// "What this can't tell you." note, ending with the axis sentence
    /// when roll and pitch were hard to tell apart.
    public let cantTell: String

    public static let readingThis =
        "Rowing: aim for little roll, so the boat stays level. Kayak: the boat should rock with the stroke; "
        + "what matters is that it rocks evenly."

    public init(_ attitude: BoatMotion, strokeRate: Double?) {
        tiles = Self.tiles(attitude, strokeRate: strokeRate)
        envelope = Self.envelope(attitude)
        excerpt = Self.excerpt(attitude)
        histogram = attitude.rollHistogram.flatMap(Self.histogram)
        cantTell =
            "We can't tell port from starboard, and a tracker or phone mounted slightly crooked looks like a "
            + "steady lean."
            + (attitude.axisConfident ? "" : " Roll and pitch were hard to tell apart in this recording.")
    }

    static func tiles(_ attitude: BoatMotion, strokeRate: Double?) -> [Tile] {
        func degrees(_ label: String, _ value: Double?, _ note: String) -> Tile {
            // Without a value the note would describe a number that isn't there.
            guard let value else {
                return Tile(label: label, value: Format.dash, note: nil, spoken: "\(label), not measured")
            }
            let unit = value == 1 ? "degree" : "degrees"
            return Tile(
                label: label, value: "\(Format.plain(value))°", note: note,
                spoken: "\(label), \(Format.plain(value)) \(unit), \(note)")
        }
        let evenness =
            attitude.symmetry.map {
                Tile(
                    label: "Evenness", value: Format.evenness($0.imbalancePct), note: "uneven",
                    spoken: "Evenness, \(Format.evenness($0.imbalancePct)), uneven")
            } ?? Tile(label: "Evenness", value: Format.dash, note: nil, spoken: "Evenness, not measured")
        let rate =
            strokeRate.map {
                let value = String(Int(($0).rounded(.toNearestOrAwayFromZero)))
                return Tile(
                    label: "Stroke rate", value: value, note: "spm", spoken: "Stroke rate, \(value), strokes per minute"
                )
            }
            ?? Tile(
                label: "Stroke rate", value: Format.dash, note: "not measured", spoken: "Stroke rate, not measured")
        return [
            degrees("Side-to-side roll", attitude.rollRmsDeg, "typical lean"),
            degrees("Bow-to-stern pitch", attitude.pitchRmsDeg, "typical tilt"),
            evenness, rate,
        ]
    }

    static func ticks(_ bound: Double) -> [Tick] {
        Format.axisTicks(bound).map { Tick(value: $0, label: "\(Format.plain($0))°") }
    }

    static func envelope(_ attitude: BoatMotion) -> Envelope {
        let bound = attitude.plotBoundDeg ?? 10
        let env = attitude.envelope
        let rounded = Format.fixed(bound, digits: 0)
        let spoken = "Roll and pitch through the session, reaching about \(rounded) degrees"
        guard env.count >= 2, let t0 = env.first?.t, let t1 = env.last?.t else {
            return Envelope(
                bound: bound, ticks: ticks(bound), bands: [], xLabels: [], clippedNote: nil, spoken: spoken)
        }
        func clamp(_ value: Double) -> Double { min(bound, max(-bound, value)) }
        let clipped = env.contains {
            [$0.rollMin, $0.rollMax, $0.pitchMin, $0.pitchMax].contains { abs($0) > bound }
        }
        let bands = env.map {
            Band(
                x: ($0.t - t0) / max(1, t1 - t0), rollMin: clamp($0.rollMin), rollMax: clamp($0.rollMax),
                pitchMin: clamp($0.pitchMin), pitchMax: clamp($0.pitchMax))
        }
        return Envelope(
            bound: bound, ticks: ticks(bound), bands: bands,
            xLabels: [Format.envelopeXLabels(t1 - t0).0, Format.envelopeXLabels(t1 - t0).1],
            clippedNote: clipped
                ? "A few moments went past ±\(rounded)° and are clipped at the chart’s edge." : nil,
            spoken: spoken)
    }

    static func excerpt(_ attitude: BoatMotion) -> Excerpt {
        let samples = attitude.excerpt
        let largest = samples.map { max(abs($0.roll), abs($0.pitch)) }.max() ?? 0
        let bound = max(largest, 1) * 1.1
        guard samples.count >= 2, let t0 = samples.first?.t, let t1 = samples.last?.t else {
            return Excerpt(bound: bound, ticks: ticks(bound), roll: [], pitch: [], xLabel: nil)
        }
        func x(_ t: Double) -> Double { (t - t0) / max(1, t1 - t0) }
        let seconds = "\(Int(((t1 - t0) / 1000).rounded(.toNearestOrAwayFromZero))) s"
        return Excerpt(
            bound: bound, ticks: ticks(bound),
            roll: samples.map { Point(x: x($0.t), value: $0.roll) },
            pitch: samples.map { Point(x: x($0.t), value: $0.pitch) },
            xLabel: attitude.sampleRateHz.map { "\(seconds) at \(Format.plain($0)) Hz" } ?? seconds)
    }

    static func histogram(_ histogram: RollHistogram) -> Histogram? {
        let bins = histogram.bins
        guard let first = bins.first else { return nil }
        let half = max(bins.map { abs($0.centreDeg) + histogram.binWidthDeg / 2 }.max() ?? 1, 1)
        let mirrored = bins.map { bin in
            let twin = bins.reduce(first) {
                abs($1.centreDeg + bin.centreDeg) < abs($0.centreDeg + bin.centreDeg) ? $1 : $0
            }
            return RollHistogram.Bin(centreDeg: bin.centreDeg, count: twin.count)
        }
        let rounded = Format.fixed(half, digits: 0)
        return Histogram(
            halfRange: half, bars: bins, mirrored: mirrored, barWidth: histogram.binWidthDeg * 0.86,
            maxCount: max(bins.map(\.count).max() ?? 1, 1), leftLabel: "\u{2212}\(rounded)°",
            rightLabel: "+\(rounded)°")
    }
}

/// The screen's fixed words, the website's exactly (mobile/contract/
/// README.md, "Boat motion"): here so a test checks each against the README.
public enum BoatMotionWords {
    public static let title = "Boat motion"
    public static let loading = "Loading"
    public static let failed = "Couldn’t read this recording."
    public static let tryAgain = "Try again"
    public static let notFound = "We can't find this recording"
    public static let backToPaddle = "Back to the paddle"
    public static let noMotion = "No boat motion for this recording."
    public static let envelopeTitle = "Through the session"
    public static let envelopeCaption =
        "The shaded band shows how far the boat rolled and pitched through the recording. "
        + "Roll is the side-to-side lean, pitch the bow rising and falling."
    public static let excerptTitle = "Stroke shape"
    public static let excerptCaption =
        "30 seconds of typical paddling. An even stroke crosses the centre line equally on both sides."
    public static let excerptSpoken = "Thirty seconds of roll and pitch at full sample rate"
    public static let histogramTitle = "Where the boat spent its time"
    public static let histogramCaption =
        "Bars show how often the boat leaned each way. The dashed line is the same, flipped. "
        + "If they match, your roll is even."
    public static let histogramSpoken =
        "Distribution of boat lean, with the mirrored distribution overlaid to show evenness"
    public static let readingThis = "Reading this."
    public static let cantTell = "What this can't tell you."
    /// Chart words, in quotes in the README.
    public static let roll = "roll", pitch = "pitch", actual = "actual", mirrored = "mirrored", level = "level"
}
