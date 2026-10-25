import DesignSystem
import MapKit
import PaddleAPI
import Paddles
import SwiftUI

/// One paddle, top to bottom as the web's paddle page: map, heading, stats,
/// conditions, why there's no route, note, coach summary, efforts and rests,
/// then the Android app's 500 m splits.
struct PaddleDetailView: View {
    @State private var model: PaddleDetailModel
    @Environment(\.dynamicTypeSize) private var typeSize

    init(id: String, source: any PaddlesSource) {
        _model = State(initialValue: PaddleDetailModel(id: id, source: source))
    }

    var body: some View {
        content
            .background(Palette.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.bg, for: .navigationBar)
            .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            MessageView(
                title: "Couldn't open this paddle", message: message,
                action: model.gone ? nil : ("Try again", { Task { await model.load() } }))
        case .loaded(let paddle):
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if !paddle.route.isEmpty {
                        VStack(spacing: 0) {
                            RouteMap(segments: paddle.route)
                                .frame(height: 300)
                            if let legend = paddle.legend { SpeedLegend(legend: legend) }
                        }
                    }
                    VStack(alignment: .leading, spacing: 20) {
                        header(paddle)
                        statsGrid(paddle.stats + paddle.conditions)
                        if let message = paddle.noGpsMessage {
                            card { Text(message).font(.plexSans(.body)).foregroundStyle(Palette.fg) }
                        }
                        if let note = paddle.note {
                            Text("“\(note)”")
                                .font(.plexSans(.body, weight: .medium))
                                .foregroundStyle(Palette.split)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel("Your note: \(note)")
                        }
                        summary(paddle)
                        if !paddle.efforts.isEmpty || !paddle.rests.isEmpty || !paddle.repeats.isEmpty {
                            efforts(paddle)
                        }
                        if !paddle.splits.isEmpty { splits(paddle.splits) }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 24)
            }
            .navigationTitle(paddle.title)
        }
    }

    private func header(_ paddle: PaddleSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let eyebrow = paddle.eyebrow { Eyebrow(eyebrow.uppercased()) }
            Text(paddle.title)
                .font(.plexSans(.title2, weight: .semibold))
                .foregroundStyle(Palette.fg)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private func statsGrid(_ stats: [PaddleSummary.Stat]) -> some View {
        card {
            // Two columns, or one at accessibility text sizes. Not lazy: a
            // lazy grid drops the rows that grow off screen.
            Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16) {
                ForEach(rows(of: stats, columns: typeSize.isAccessibilitySize ? 1 : 2), id: \.first?.label) { row in
                    GridRow {
                        ForEach(row, id: \.label) { stat in
                            StatView(label: stat.label, value: stat.value, sub: stat.sub)
                        }
                    }
                }
            }
        }
    }

    private func rows(of stats: [PaddleSummary.Stat], columns: Int) -> [[PaddleSummary.Stat]] {
        stride(from: 0, to: stats.count, by: columns).map { Array(stats[$0..<min($0 + columns, stats.count)]) }
    }

    @ViewBuilder private func summary(_ paddle: PaddleSummary) -> some View {
        if paddle.summaryPending {
            Text("Writing your summary…")
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
        } else if let text = paddle.coachSummary {
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(Palette.primary).frame(width: 2)
                Text(text)
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Summary: \(text)")
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.plexSans(.title3, weight: .semibold))
            .foregroundStyle(Palette.fg)
            .accessibilityAddTraits(.isHeader)
    }

    private func efforts(_ paddle: PaddleSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Efforts and rests")
            if !paddle.repeats.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("REPEATS")
                    ForEach(paddle.repeats, id: \.self) { Text($0).font(.plexMono(.body)).foregroundStyle(Palette.fg) }
                }
            }
            if !paddle.efforts.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(paddle.efforts, id: \.number) { effort in
                        if effort.number > 1 { Divider().overlay(Palette.border) }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Effort \(effort.number) at \(effort.at)")
                                .font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                            Text("\(effort.lasted) · \(effort.pace)/500 · \(effort.spm) spm")
                                .font(.plexMono(.body)).foregroundStyle(Palette.fg)
                            if let trend = effort.trend {
                                Text(trend).font(.plexSans(.subheadline)).foregroundStyle(Palette.split)
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
                .background(Palette.surface)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
                .clipShape(RoundedRectangle(cornerRadius: Radius.control))
            }
            if !paddle.rests.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("RESTS")
                    Text(paddle.rests.joined(separator: "   "))
                        .font(.plexMono(.subheadline)).foregroundStyle(Palette.muted)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func splits(_ rows: [PaddleSummary.Split]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("500 m splits")
            VStack(spacing: 0) {
                // At accessibility sizes four columns don't fit: one line each.
                if !typeSize.isAccessibilitySize {
                    splitLine(["KM", "AT", "/500", "SPM"], header: true).accessibilityHidden(true)
                }
                ForEach(rows, id: \.km) { row in
                    Divider().overlay(Palette.border)
                    Group {
                        if typeSize.isAccessibilitySize {
                            Text("\(row.km) km at \(row.at): \(row.pace)/500, \(row.spm) spm")
                                .font(.plexMono(.body)).foregroundStyle(Palette.fg)
                                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                        } else {
                            splitLine([row.km, row.at, row.pace, row.spm], header: false)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        "\(row.km) kilometres at \(row.at), \(row.pace) per 500, \(row.spm) strokes a minute")
                }
            }
            .padding(.horizontal, 12)
            .background(Palette.surface)
            .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
            .clipShape(RoundedRectangle(cornerRadius: Radius.control))
        }
        .accessibilityIdentifier("splits")
    }

    private func splitLine(_ cells: [String], header: Bool) -> some View {
        HStack {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                Text(cell)
                    .font(.plexMono(header ? .caption : .body))
                    .foregroundStyle(header ? Palette.muted : index == 2 ? Palette.primaryText : Palette.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minHeight: 40)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface)
            .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
            .clipShape(RoundedRectangle(cornerRadius: Radius.control))
    }
}

/// The speed colours' ends under the map: blue slower, red faster, as paces.
struct SpeedLegend: View {
    let legend: PaddleSummary.Legend

    var body: some View {
        VStack(spacing: 4) {
            LinearGradient(
                stops: [0, 0.4, 0.7, 1].map { .init(color: Color(ColourScale.ramp($0)), location: $0) },
                startPoint: .leading, endPoint: .trailing
            )
            .frame(height: 6)
            .clipShape(Capsule())
            HStack {
                Text(legend.slower)
                Spacer()
                Text(legend.faster)
            }
            .font(.plexMono(.footnote))
            .foregroundStyle(Palette.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Palette.surface)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Speed colours: blue \(legend.slower), red \(legend.faster)")
    }
}

/// The route on a dark, muted map, coloured slow (blue) to fast (red). Data
/// stays square, like the web's maps.
struct RouteMap: View {
    let segments: [PaddleSummary.RouteSegment]

    var body: some View {
        Map(initialPosition: .rect(Self.bounds(segments))) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                MapPolyline(coordinates: segment.coordinates.map(\.location))
                    .stroke(Color(segment.colour), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
            if let start = segments.first?.coordinates.first {
                Annotation("Start", coordinate: start.location) { dot(Palette.green) }
            }
            if let finish = segments.last?.coordinates.last {
                Annotation("Finish", coordinate: finish.location) { dot(Palette.red) }
            }
        }
        .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
        .environment(\.colorScheme, .dark)
        .accessibilityElement()
        .accessibilityLabel("Map of the route, coloured by speed from blue for slower to red for faster")
    }

    private func dot(_ colour: Color) -> some View {
        Circle().fill(colour).frame(width: 10, height: 10).overlay(Circle().stroke(Palette.bg, lineWidth: 2))
    }

    /// The route's bounding box, padded so the line doesn't touch the edges.
    static func bounds(_ segments: [PaddleSummary.RouteSegment]) -> MKMapRect {
        let points = segments.flatMap(\.coordinates).map { MKMapPoint($0.location) }
        guard let first = points.first else { return .world }
        var rect = MKMapRect(origin: first, size: MKMapSize(width: 0, height: 0))
        for point in points.dropFirst() {
            rect = rect.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
        }
        let pad = max(rect.size.width, rect.size.height) * 0.15 + 200
        return rect.insetBy(dx: -pad, dy: -pad)
    }
}

extension Coordinate {
    var location: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension Color {
    init(_ rgb: ColourScale.RGB) {
        self.init(.sRGB, red: Double(rgb.red) / 255, green: Double(rgb.green) / 255, blue: Double(rgb.blue) / 255)
    }
}
