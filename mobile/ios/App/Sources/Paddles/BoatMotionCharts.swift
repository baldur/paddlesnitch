import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI

/// The website's chart frame (BoatMotion.tsx): margins in points, chart
/// text at 11 pt whatever the width or text size, a 34 pt legend band.
private enum Frame {
    static let left: CGFloat = 44, right: CGFloat = 14, top: CGFloat = 14, bottom: CGFloat = 26
    static let legendTop: CGFloat = 34

    static func text(_ string: String, _ colour: Color = Palette.muted) -> Text {
        Text(string).font(.custom(FontFamily.mono, fixedSize: 11)).foregroundStyle(colour)
    }

    /// Gridlines in `border` with "-6°" labels, and the zero line in `muted`.
    static func grid(
        _ context: GraphicsContext, ticks: [BoatMotionSummary.Tick], width: CGFloat, y: (Double) -> CGFloat
    ) {
        for tick in ticks {
            var line = Path()
            line.move(to: CGPoint(x: left, y: y(tick.value)))
            line.addLine(to: CGPoint(x: width - right, y: y(tick.value)))
            context.stroke(line, with: .color(Palette.border), lineWidth: 1)
            context.draw(text(tick.label), at: CGPoint(x: left - 8, y: y(tick.value)), anchor: .trailing)
        }
        var zero = Path()
        zero.move(to: CGPoint(x: left, y: y(0)))
        zero.addLine(to: CGPoint(x: width - right, y: y(0)))
        context.stroke(zero, with: .color(Palette.muted), lineWidth: 1.2)
    }

    /// A legend swatch at 0.8 opacity, whatever its series' own.
    static func swatch(_ context: GraphicsContext, _ colour: Color, _ label: String, at x: CGFloat) {
        context.fill(Path(CGRect(x: x, y: 4, width: 10, height: 10)), with: .color(colour.opacity(0.8)))
        context.draw(text(label), at: CGPoint(x: x + 14, y: 9), anchor: .leading)
    }
}

/// "Through the session": roll and pitch bands, one per bucket.
struct EnvelopeChart: View {
    let envelope: BoatMotionSummary.Envelope

    var body: some View {
        Canvas { context, size in
            guard !envelope.bands.isEmpty else { return }
            let width = size.width, height = size.height, bound = envelope.bound
            func x(_ fraction: Double) -> CGFloat { Frame.left + fraction * (width - Frame.left - Frame.right) }
            func y(_ deg: Double) -> CGFloat {
                Frame.legendTop + (bound - deg) / (2 * bound) * (height - Frame.legendTop - Frame.bottom)
            }
            Frame.grid(context, ticks: envelope.ticks, width: width, y: y)
            func band(_ low: (BoatMotionSummary.Band) -> Double, _ high: (BoatMotionSummary.Band) -> Double) -> Path {
                var path = Path()
                path.addLines(envelope.bands.map { CGPoint(x: x($0.x), y: y(high($0))) })
                for band in envelope.bands.reversed() { path.addLine(to: CGPoint(x: x(band.x), y: y(low(band)))) }
                path.closeSubpath()
                return path
            }
            context.fill(band(\.pitchMin, \.pitchMax), with: .color(Palette.green.opacity(0.28)))
            context.fill(band(\.rollMin, \.rollMax), with: .color(Palette.split.opacity(0.5)))
            if envelope.xLabels.count == 2 {
                context.draw(
                    Frame.text(envelope.xLabels[0]), at: CGPoint(x: Frame.left, y: height - 8), anchor: .leading)
                context.draw(
                    Frame.text(envelope.xLabels[1]), at: CGPoint(x: width - Frame.right, y: height - 8),
                    anchor: .trailing)
            }
            Frame.swatch(context, Palette.split, "roll", at: width - Frame.right - 108)
            Frame.swatch(context, Palette.green, "pitch", at: width - Frame.right - 58)
        }
        .frame(height: 260)
        .accessibilityElement()
        .accessibilityLabel(envelope.spoken)
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("motion-envelope")
    }
}

/// "Stroke shape": thirty seconds of roll and pitch.
struct ExcerptChart: View {
    let excerpt: BoatMotionSummary.Excerpt

    var body: some View {
        Canvas { context, size in
            guard !excerpt.roll.isEmpty else { return }
            let width = size.width, height = size.height, bound = excerpt.bound
            func x(_ fraction: Double) -> CGFloat { Frame.left + fraction * (width - Frame.left - Frame.right) }
            func y(_ deg: Double) -> CGFloat {
                Frame.top + (bound - deg) / (2 * bound) * (height - Frame.top - Frame.bottom)
            }
            Frame.grid(context, ticks: excerpt.ticks, width: width, y: y)
            func line(_ points: [BoatMotionSummary.Point]) -> Path {
                var path = Path()
                path.addLines(points.map { CGPoint(x: x($0.x), y: y($0.value)) })
                return path
            }
            context.stroke(line(excerpt.pitch), with: .color(Palette.green.opacity(0.7)), lineWidth: 1.2)
            context.stroke(line(excerpt.roll), with: .color(Palette.split), lineWidth: 1.8)
            if let label = excerpt.xLabel {
                context.draw(Frame.text(label), at: CGPoint(x: Frame.left, y: height - 8), anchor: .leading)
            }
        }
        .frame(height: 260)
        .accessibilityElement()
        .accessibilityLabel("Thirty seconds of roll and pitch at full sample rate")
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("motion-excerpt")
    }
}

/// "Where the boat spent its time": the roll histogram and its mirror.
struct HistogramChart: View {
    let histogram: BoatMotionSummary.Histogram?

    var body: some View {
        Canvas { context, size in
            guard let histogram else { return }
            let width = size.width, height = size.height, half = histogram.halfRange
            let bottom: CGFloat = 30
            func x(_ deg: Double) -> CGFloat {
                Frame.left + (deg + half) / (2 * half) * (width - Frame.left - Frame.right)
            }
            func y(_ count: Int) -> CGFloat {
                Frame.legendTop + (1 - CGFloat(count) / CGFloat(histogram.maxCount))
                    * (height - Frame.legendTop - bottom)
            }
            let barWidth = x(histogram.barWidth) - x(0)
            for bar in histogram.bars {
                let top = y(bar.count)
                let rect = CGRect(
                    x: x(bar.centreDeg) - barWidth / 2, y: top, width: barWidth, height: max(0, height - bottom - top))
                context.fill(Path(rect), with: .color(Palette.split.opacity(0.45)))
            }
            var mirror = Path()
            mirror.addLines(histogram.mirrored.map { CGPoint(x: x($0.centreDeg), y: y($0.count)) })
            let dashed = StrokeStyle(lineWidth: 1.6, dash: [4, 3])
            context.stroke(mirror, with: .color(Palette.red), style: dashed)
            var level = Path()
            level.move(to: CGPoint(x: x(0), y: Frame.legendTop))
            level.addLine(to: CGPoint(x: x(0), y: height - bottom))
            context.stroke(level, with: .color(Palette.muted), lineWidth: 1.2)
            context.draw(Frame.text("level"), at: CGPoint(x: x(0), y: height - 14), anchor: .center)
            context.draw(Frame.text(histogram.leftLabel), at: CGPoint(x: Frame.left, y: height - 14), anchor: .leading)
            context.draw(
                Frame.text(histogram.rightLabel), at: CGPoint(x: width - Frame.right, y: height - 14), anchor: .trailing
            )
            Frame.swatch(context, Palette.split, "actual", at: Frame.left + 6)
            var key = Path()
            key.move(to: CGPoint(x: Frame.left + 70, y: 9))
            key.addLine(to: CGPoint(x: Frame.left + 88, y: 9))
            context.stroke(key, with: .color(Palette.red.opacity(0.8)), style: dashed)
            context.draw(Frame.text("mirrored"), at: CGPoint(x: Frame.left + 94, y: 9), anchor: .leading)
        }
        .frame(height: 230)
        .accessibilityElement()
        .accessibilityLabel("Distribution of boat lean, with the mirrored distribution overlaid to show evenness")
        .accessibilityAddTraits(.isImage)
        .accessibilityIdentifier("motion-histogram")
    }
}
