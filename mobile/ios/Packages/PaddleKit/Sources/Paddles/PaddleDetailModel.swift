import Observation
import PaddleAPI

/// One paddle's screen.
@MainActor @Observable
public final class PaddleDetailModel {
    public private(set) var state: Loadable<PaddleSummary> = .loading
    public let id: String
    private let source: any PaddlesSource

    public init(id: String, source: any PaddlesSource) {
        self.id = id
        self.source = source
    }

    public func load() async {
        do {
            state = .loaded(PaddleSummary(try await source.paddle(id: id)))
        } catch {
            state = .failed(FailureMessage.of(error))
        }
    }
}

/// A paddle, worked into what its screen shows, top to bottom as on the web
/// (AnalysisView.tsx). Pure, so it's tested without a screen.
public struct PaddleSummary: Hashable, Sendable {
    public struct Stat: Hashable, Sendable {
        /// Upper-case mono label: "PACE".
        public let label: String
        public let value: String
        public let sub: String?

        public init(label: String, value: String, sub: String?) {
            self.label = label
            self.value = value
            self.sub = sub
        }
    }

    public struct RouteSegment: Hashable, Sendable {
        public let coordinates: [Coordinate]
        public let colour: ColourScale.RGB
    }

    /// "Sun, 13 Sep 2026"
    public let title: String
    /// "Tracker · K1"
    public let eyebrow: String?
    public let stats: [Stat]
    public let conditions: [Stat]
    /// Why there's no route, for a paddle without GPS.
    public let noGpsMessage: String?
    /// The route, coloured by speed. Empty without GPS.
    public let route: [RouteSegment]
    public let coachSummary: String?
    public let summaryPending: Bool
    public let note: String?

    public init(_ paddle: AnalysisSession) {
        let result = paddle.result
        title = Format.weekday(paddle.paddledAt)
        let eyebrowParts = [Format.source(paddle.source.type), paddle.boatClass?.rawValue].compactMap { $0 }
        eyebrow = eyebrowParts.isEmpty ? nil : eyebrowParts.joined(separator: " · ")
        stats = result.noGps.map { Self.motionStats(result, noGps: $0) } ?? Self.gpsStats(result)
        conditions = Self.conditions(result.conditions)
        noGpsMessage = result.noGps.map { Format.noPaddleMessage($0.reason, hasMotion: true) }
        route = result.noGps == nil ? Self.segments(result.points) : []
        let insight = paddle.insight.isEmpty ? result.insight : paddle.insight
        coachSummary = insight.isEmpty ? nil : insight
        summaryPending = paddle.insightPending == true
        note = paddle.note.isEmpty ? nil : paddle.note
    }

    static func gpsStats(_ result: AnalysisResult) -> [Stat] {
        var stats = [
            Stat(label: "TIME", value: Format.clock(result.durationS), sub: nil),
            Stat(label: "DISTANCE", value: Format.distance(km: result.distanceKm), sub: nil),
            Stat(label: "PACE", value: Format.split500(speed: result.cruiseSpeed), sub: "/500, cruising"),
            strokeRate(result),
        ]
        if let dps = result.avgDps {
            stats.append(Stat(label: "PER STROKE", value: Format.perStroke(dps), sub: nil))
        }
        return stats
    }

    static func motionStats(_ result: AnalysisResult, noGps: AnalysisResult.NoGps) -> [Stat] {
        [
            Stat(label: "PADDLING", value: Format.clock(result.durationS), sub: "from the boat's motion"),
            Stat(label: "DISTANCE", value: Format.dash, sub: "no GPS"),
            strokeRate(result),
            Stat(label: "STROKES", value: "\(noGps.strokes)", sub: "about"),
        ]
    }

    static func strokeRate(_ result: AnalysisResult) -> Stat {
        guard let rate = result.avgSR else {
            return Stat(label: "STROKE RATE", value: Format.dash, sub: "not in this file")
        }
        return Stat(
            label: "STROKE RATE", value: "\(Int(rate.rounded()))",
            sub: result.strokeRateDoubled ? "spm, doubled" : "spm")
    }

    static func conditions(_ conditions: Conditions?) -> [Stat] {
        guard let conditions else { return [] }
        var stats: [Stat] = []
        if let wind = conditions.windKmh {
            let from = conditions.windDir.map { "from the \(Format.compass(degrees: $0))" }
            stats.append(Stat(label: "WIND", value: Format.wind(kmh: wind), sub: from))
        }
        if let flow = conditions.flowM3s {
            stats.append(
                Stat(label: "RIVER", value: Format.flow(m3s: flow), sub: conditions.flowStation.map { "at \($0)" }))
        }
        return stats
    }

    /// Runs of neighbouring points with the same colour, each sharing its last
    /// point with the next so the line has no gaps. Keeps the map to a few
    /// dozen polylines instead of one per point.
    static func segments(_ points: [AnalysisPoint]) -> [RouteSegment] {
        let colours = ColourScale.colours(points, metric: .speed)
        var segments: [RouteSegment] = []
        var run: [Coordinate] = []
        var runColour: ColourScale.RGB?
        for (point, colour) in zip(points, colours) {
            let coordinate = Coordinate(latitude: point.lat, longitude: point.lng)
            if let current = runColour, current != colour {
                run.append(coordinate)
                segments.append(RouteSegment(coordinates: run, colour: current))
                run = []
            }
            run.append(coordinate)
            runColour = colour
        }
        if let runColour, run.count > 1 {
            segments.append(RouteSegment(coordinates: run, colour: runColour))
        }
        return segments
    }
}
