import PaddleAPI

/// The route's colour scale, ported from the web (components/map/colour-scale.ts):
/// slow (blue) to fast (red), between the paddle's own 10th and 90th
/// percentiles, so every paddle uses the whole ramp.
public enum ColourScale {
    public struct RGB: Hashable, Sendable {
        public var red: Int
        public var green: Int
        public var blue: Int
    }

    public enum Metric: Sendable {
        case speed, strokeRate
    }

    /// A value whose speed or rate is missing.
    public static let missing = RGB(red: 0x47, green: 0x55, blue: 0x69)

    static let stops: [(at: Double, colour: RGB)] = [
        (0, RGB(red: 37, green: 99, blue: 235)),
        (0.4, RGB(red: 6, green: 182, blue: 212)),
        (0.7, RGB(red: 234, green: 179, blue: 8)),
        (1, RGB(red: 220, green: 38, blue: 38)),
    ]

    /// The colour at `t` in 0...1 (clamped), interpolated between the stops.
    public static func ramp(_ t: Double) -> RGB {
        let t = min(1, max(0, t))
        for (low, high) in zip(stops, stops.dropFirst()) where t <= high.at {
            let f = (t - low.at) / (high.at - low.at)
            func mix(_ a: Int, _ b: Int) -> Int { Int((Double(a) + f * Double(b - a)).rounded()) }
            return RGB(
                red: mix(low.colour.red, high.colour.red),
                green: mix(low.colour.green, high.colour.green),
                blue: mix(low.colour.blue, high.colour.blue))
        }
        return stops[stops.count - 1].colour
    }

    /// The low and high ends of the scale, or nil with fewer than two values.
    public static func bounds(_ points: [AnalysisPoint], metric: Metric) -> (low: Double, high: Double)? {
        let values = points.compactMap { value(of: $0, metric) }.filter { $0 > 0 }.sorted()
        guard values.count >= 2 else { return nil }
        func quantile(_ p: Double) -> Double { values[min(values.count - 1, Int(p / 100 * Double(values.count)))] }
        return (quantile(10), quantile(90))
    }

    /// Each point's colour on this paddle's scale.
    public static func colours(_ points: [AnalysisPoint], metric: Metric) -> [RGB] {
        guard let (low, high) = bounds(points, metric: metric) else { return points.map { _ in missing } }
        let range = high - low == 0 ? 1 : high - low
        return points.map { point in
            guard let value = value(of: point, metric) else { return missing }
            return ramp((value - low) / range)
        }
    }

    static func value(of point: AnalysisPoint, _ metric: Metric) -> Double? {
        switch metric {
        case .speed: point.speed
        case .strokeRate: point.sr
        }
    }
}
