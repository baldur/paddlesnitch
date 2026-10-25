import Foundation
import PaddleAPI

/// The paddle page's lower half: the speed legend, efforts and rests (the
/// web's AnalysisView.tsx), and 500 m splits (the Android app's, which the
/// web doesn't have). Each is the Android app's PaddleDetail.kt, line for line.
extension PaddleSummary {
    /// The ends of the route's speed colours as paces.
    public struct Legend: Hashable, Sendable {
        /// The blue end: "2:41/500".
        public let slower: String
        /// The red end.
        public let faster: String
    }

    public struct Effort: Hashable, Sendable {
        public let number: Int
        /// When it started, from the start of the paddle: "1:53".
        public let at: String
        public let lasted: String
        public let pace: String
        public let spm: String
        /// The web's word for how it went: "steady", "faded".
        public let trend: String?
    }

    public struct Split: Hashable, Sendable {
        /// "0.5", "1.0", or a last part "1.23".
        public let km: String
        public let at: String
        public let pace: String
        public let spm: String
    }

    static func legend(_ points: [AnalysisPoint]) -> Legend? {
        ColourScale.bounds(points, metric: .speed).map {
            Legend(slower: pace($0.low, else: "slower"), faster: pace($0.high, else: "faster"))
        }
    }

    private static func pace(_ speed: Double, else fallback: String) -> String {
        let split = Format.split500(speed: speed)
        return split == Format.dash ? fallback : "\(split)/500"
    }

    /// Sets of more than one effort: "4 × 1:30 at 2:05/500, 72 spm".
    static func repeats(_ sets: [SessionSet]) -> [String] {
        sets.filter { $0.count > 1 }.map { set in
            "\(set.count) × \(Format.minutesSeconds(set.avgDurS)) at \(Format.split500(speed: set.avgSpeed))/500"
                + (set.avgSR.map { ", \(Int($0.rounded())) spm" } ?? "")
        }
    }

    static func efforts(_ surges: [Segment]) -> [Effort] {
        surges.enumerated().map { index, surge in
            Effort(
                number: index + 1, at: Format.clock(surge.fromT), lasted: Format.minutesSeconds(surge.durS),
                pace: Format.split500(speed: surge.avgSpeed),
                spm: surge.avgSR.map { "\(Int($0.rounded()))" } ?? Format.dash,
                trend: surge.trend?.isEmpty == false ? surge.trend : nil)
        }
    }

    /// "29 s at 1:23", or "2:10 at 14:05" from a minute up.
    static func rests(_ stops: [Segment]) -> [String] {
        stops.map { stop in
            let lasted = stop.durS >= 60 ? Format.minutesSeconds(stop.durS) : "\(Int(stop.durS.rounded())) s"
            return "\(lasted) at \(Format.clock(stop.fromT))"
        }
    }

    /// 500 m splits along the track: the clock at each 500 m mark
    /// (interpolated between points), the pace over that 500 m and the mean
    /// stroke rate in it. A last part of 100 m or more gets its own row.
    /// None for a paddle under 500 m.
    static func splits(_ points: [AnalysisPoint]) -> [Split] {
        guard let start = points.first?.t else { return [] }
        var rows: [Split] = []
        var distance = 0.0
        var fromT = start
        var fromD = 0.0
        func row(to toD: Double, at toT: Double) {
            let rates = points.filter { $0.t >= fromT && $0.t <= toT }.compactMap(\.sr)
            rows.append(
                Split(
                    km: Format.fixed(toD / 1000, digits: toD.truncatingRemainder(dividingBy: 500) == 0 ? 1 : 2),
                    at: Format.clock(toT - start), pace: Format.split500(speed: (toD - fromD) / (toT - fromT)),
                    spm: rates.isEmpty ? Format.dash : "\(Int((rates.reduce(0, +) / Double(rates.count)).rounded()))"))
            fromT = toT
            fromD = toD
        }
        for (a, b) in zip(points, points.dropFirst()) {
            let d = haversine(a, b)
            while d > 0 && distance + d >= fromD + 500 {
                let mark = fromD + 500
                row(to: mark, at: a.t + (b.t - a.t) * (mark - distance) / d)
            }
            distance += d
        }
        if !rows.isEmpty && distance - fromD >= 100 {
            row(to: distance, at: points[points.count - 1].t)
        }
        return rows
    }

    /// Metres between two points (the web's haversine, packages/timing/src/geo.ts).
    static func haversine(_ a: AnalysisPoint, _ b: AnalysisPoint) -> Double {
        let rad = Double.pi / 180
        let dLat = (b.lat - a.lat) * rad
        let dLng = (b.lng - a.lng) * rad
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(a.lat * rad) * cos(b.lat * rad) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * 6_371_000 * asin(sqrt(h))
    }
}
