import DesignSystem
import PaddleAPI
import SwiftUI

/// A paddle's route as a small line drawing, like the web's `RouteThumb`:
/// the track in blue on the dark ground, a green dot where it started.
struct RouteThumb: View {
    let route: [Coordinate]

    var body: some View {
        Canvas { context, size in
            let points = Self.project(route, into: size, inset: 6)
            guard points.count > 1, let start = points.first else { return }
            var path = Path()
            path.addLines(points)
            context.stroke(path, with: .color(Palette.primary), style: StrokeStyle(lineWidth: 2, lineJoin: .round))
            let dot = CGRect(x: start.x - 2.6, y: start.y - 2.6, width: 5.2, height: 5.2)
            context.fill(Path(ellipseIn: dot), with: .color(Palette.green))
        }
        .overlay {
            if route.count < 2 {
                Text("no map").font(.plexMono(.caption)).foregroundStyle(Palette.muted)
            }
        }
        .frame(width: 64, height: 64)
        .background(Palette.bg)
        .clipShape(RoundedRectangle(cornerRadius: Radius.control))
        .accessibilityHidden(true)
    }

    /// Fits the route into `size`, keeping its shape: longitude is scaled by
    /// cos(latitude) so a route doesn't look stretched east-west.
    static func project(_ route: [Coordinate], into size: CGSize, inset: CGFloat) -> [CGPoint] {
        guard let first = route.first else { return [] }
        let scaleX = cos(first.latitude * .pi / 180)
        let xs = route.map { $0.longitude * scaleX }
        let ys = route.map { $0.latitude }
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return [] }
        let span = max(maxX - minX, maxY - minY, 1e-9)
        let side = min(size.width, size.height) - inset * 2
        let offsetX = (size.width - side * (maxX - minX) / span) / 2
        let offsetY = (size.height - side * (maxY - minY) / span) / 2
        return zip(xs, ys).map { x, y in
            CGPoint(x: offsetX + (x - minX) / span * side, y: offsetY + (maxY - y) / span * side)
        }
    }
}
