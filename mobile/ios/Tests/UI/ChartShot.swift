import XCTest

/// A chart's screenshot, read in points. The boat motion charts are drawn in
/// a Canvas, which XCUITest can't see into, so their rules are checked here.
struct ChartShot {
    let pixels: Pixels
    let width: CGFloat
    let height: CGFloat

    init?(_ chart: XCUIElement) {
        let image = chart.screenshot().image
        guard let pixels = Pixels(image) else { return nil }
        self.pixels = pixels
        width = image.size.width
        height = image.size.height
    }

    static let surface = Pixels.RGB(r: 0x0f, g: 0x17, b: 0x2a)
    static let muted = Pixels.RGB(r: 0x94, g: 0xa3, b: 0xb8)

    /// `colour` at `opacity` over the chart's surface.
    static func faded(_ colour: Pixels.RGB, _ opacity: Double) -> Pixels.RGB {
        func mix(_ a: Int, _ b: Int) -> Int { Int((Double(a) * opacity + Double(b) * (1 - opacity)).rounded()) }
        return Pixels.RGB(r: mix(colour.r, surface.r), g: mix(colour.g, surface.g), b: mix(colour.b, surface.b))
    }

    func at(_ x: CGFloat, _ y: CGFloat) -> Pixels.RGB { pixels.at(x: x, y: y) }

    /// The span of x (0.5 pt steps, the right half unless told) on row `y`
    /// where `matches`.
    func run(
        y: CGFloat, from start: CGFloat? = nil, to end: CGFloat? = nil, _ matches: (Pixels.RGB) -> Bool
    ) -> ClosedRange<CGFloat>? {
        let xs = stride(from: start ?? width / 2, to: end ?? width, by: 0.5).filter { matches(at($0, y)) }
        guard let first = xs.first, let last = xs.last else { return nil }
        return first...last
    }

    /// The legend's words in the right half: spans of columns with muted
    /// ink on the legend's rows (y 11–23), split where 10 pt are bare.
    func legendWords() -> [ClosedRange<CGFloat>] {
        var words: [ClosedRange<CGFloat>] = []
        for x in stride(from: width / 2, to: width, by: 0.5) {
            let inked = stride(from: CGFloat(11), to: 23, by: 0.5).contains { at(x, $0).near(Self.muted) }
            guard inked else { continue }
            if let last = words.last, x - last.upperBound <= 10 {
                words[words.count - 1] = last.lowerBound...x
            } else {
                words.append(x...x)
            }
        }
        return words
    }

    /// How thick `colour` is down the column at `x`, within 4 pt of `y`:
    /// each pixel's share of the colour over the surface, summed, so the
    /// soft edges count for what they cover.
    func thickness(of colour: Pixels.RGB, x: CGFloat, around y: CGFloat) -> CGFloat {
        let step = 1 / pixels.scale
        let full = [colour.r - Self.surface.r, colour.g - Self.surface.g, colour.b - Self.surface.b]
        let length = Double(full.reduce(0) { $0 + $1 * $1 })
        let cover = stride(from: y - 4, to: y + 4, by: step).map { row -> Double in
            let pixel = at(x, row)
            let seen = [pixel.r - Self.surface.r, pixel.g - Self.surface.g, pixel.b - Self.surface.b]
            return min(1, max(0, Double(zip(seen, full).reduce(0) { $0 + $1.0 * $1.1 }) / length))
        }
        return CGFloat(cover.reduce(0, +)) * step
    }

    /// `colour`'s ink in `rect` (on a 0.5 pt grid) and the share of it in
    /// pieces at most 8 pt long. A dashed line (4 pt on, 3 off) is nearly
    /// all short pieces; a solid one is long.
    func dashes(of colour: Pixels.RGB, within: Int, in rect: CGRect) -> (ink: Int, short: Double) {
        let step: CGFloat = 0.5
        let columns = Int(rect.width / step), rows = Int(rect.height / step)
        var open = [Bool](repeating: false, count: columns * rows)
        for index in open.indices {
            let x = rect.minX + CGFloat(index % columns) * step, y = rect.minY + CGFloat(index / columns) * step
            open[index] = at(x, y).near(colour, within: within)
        }
        var ink = 0, short = 0
        for start in open.indices where open[start] {
            open[start] = false
            var stack = [start], count = 0
            var left = Int.max, right = 0, top = Int.max, bottom = 0
            while let index = stack.popLast() {
                count += 1
                let row = index / columns, column = index % columns
                (left, right, top, bottom) = (min(left, column), max(right, column), min(top, row), max(bottom, row))
                for near in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)] {
                    let r = row + near.0, c = column + near.1
                    guard r >= 0, r < rows, c >= 0, c < columns, open[r * columns + c] else { continue }
                    open[r * columns + c] = false
                    stack.append(r * columns + c)
                }
            }
            ink += count
            if CGFloat(max(right - left, bottom - top)) * step <= 8 { short += count }
        }
        return (ink, ink == 0 ? 0 : Double(short) / Double(ink))
    }
}
