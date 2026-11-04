import Account
import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI

/// A paddle's boat motion, as the website's /paddles/[id]/motion
/// (mobile/contract/README.md, "Boat motion"). Every number comes from the
/// server; this draws.
struct BoatMotionView: View {
    /// The paddle page's: what this screen loads also fills its tiles.
    let model: BoatMotionModel
    @Environment(AppNavigator.self) private var navigator
    @Environment(\.dismiss) private var dismiss
    @AccessibilityFocusState private var errorFocused: Bool
    @State private var width: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize

    /// A model that reads the recording's motion as the signed-in account.
    static func model(_ recording: MotionRecording, account: AccountModel) -> BoatMotionModel {
        BoatMotionModel(recording: recording) { etag in
            try await account.client.sendIfChanged(
                Endpoints.getAccountDevicesSessionsBySessionId, RecordingOf(deviceId: recording.deviceId),
                pathValues: ["sessionId": recording.sessionId], etag: etag)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Format.dayTime(model.recording.paddledAt, zone: .current))
                        .font(.plexSans(.subheadline))
                        .foregroundStyle(Palette.muted)
                    Text(BoatMotionWords.title)
                        .font(.plexSans(.title2, weight: .semibold))
                        .foregroundStyle(Palette.fg)
                        .accessibilityAddTraits(.isHeader)
                }
                content
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
        }
        .background(Palette.bg)
        .refreshable { await model.load() }
        .task { await model.load() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.bg, for: .navigationBar)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            HStack(spacing: 8) {
                ProgressView().tint(Palette.muted)
                Text(BoatMotionWords.loading).font(.plexSans(.body)).foregroundStyle(Palette.muted)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(BoatMotionWords.loading)
        case .failed:
            VStack(alignment: .leading, spacing: 12) {
                Text(BoatMotionWords.failed)
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.red)
                    .accessibilityFocused($errorFocused)
                Button(BoatMotionWords.tryAgain) { Task { await model.load() } }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("motion-try-again")
            }
            // `initial`: Try again rebuilds this view with the count already
            // at 2, so a plain onChange never saw it.
            .onChange(of: model.failures, initial: true) { errorFocused = model.focusError }
        case .notFound:
            VStack(alignment: .leading, spacing: 12) {
                Text(BoatMotionWords.notFound)
                    .font(.plexSans(.title3, weight: .semibold))
                    .foregroundStyle(Palette.fg)
                Button(BoatMotionWords.backToPaddle) { dismiss() }
                    .buttonStyle(.bordered)
            }
        case .noMotion(let none):
            box {
                Text(BoatMotionWords.noMotion)
                    .font(.plexSans(.body, weight: .medium))
                    .foregroundStyle(Palette.fg)
                Text(none.copy).font(.plexSans(.body)).foregroundStyle(Palette.muted)
                if let device = none.open {
                    Button(device.button) {
                        device == .phone ? navigator.openPaddles() : navigator.openTrackers()
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("motion-open-device")
                }
            }
        case .loaded(let summary):
            loaded(summary)
        }
    }

    private func loaded(_ summary: BoatMotionSummary) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            tiles(summary.tiles)
            ChartPanel(
                title: BoatMotionWords.envelopeTitle,
                caption: BoatMotionWords.envelopeCaption,
                note: summary.envelope.clippedNote
            ) {
                EnvelopeChart(envelope: summary.envelope)
            }
            ChartPanel(
                title: BoatMotionWords.excerptTitle,
                caption: BoatMotionWords.excerptCaption
            ) {
                ExcerptChart(excerpt: summary.excerpt)
            }
            ChartPanel(
                title: BoatMotionWords.histogramTitle,
                caption: BoatMotionWords.histogramCaption
            ) {
                HistogramChart(histogram: summary.histogram)
            }
            box {
                (Text(BoatMotionWords.readingThis + " ").foregroundStyle(Palette.fg)
                    + Text(BoatMotionSummary.readingThis))
                (Text(BoatMotionWords.cantTell + " ").foregroundStyle(Palette.fg) + Text(summary.cantTell))
            }
            .font(.plexSans(.subheadline))
            .foregroundStyle(Palette.muted)
        }
    }

    /// Two columns on a phone, four from 640 pt, one at accessibility text
    /// sizes (two broke "EVENNESS" mid-word). Not lazy: a lazy grid
    /// drops rows that grow off screen.
    @ViewBuilder private func tiles(_ tiles: [BoatMotionSummary.Tile]) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(spacing: 8) { ForEach(tiles, id: \.label) { MotionTile(tile: $0) } }
        } else {
            let columns = width >= 640 ? 4 : 2
            let rows = stride(from: 0, to: tiles.count, by: columns).map {
                Array(tiles[$0..<min($0 + columns, tiles.count)])
            }
            Grid(alignment: .topLeading, horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(rows, id: \.first?.label) { row in
                    GridRow { ForEach(row, id: \.label) { MotionTile(tile: $0) } }
                }
            }
        }
    }

    private func box(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface)
            .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
            .clipShape(RoundedRectangle(cornerRadius: Radius.control))
    }
}

/// One tile: its label as an eyebrow, the value, a note; read as one
/// element in words. Also on the paddle page.
struct MotionTile: View {
    let tile: BoatMotionSummary.Tile

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Eyebrow(tile.label.uppercased())
                .fixedSize(horizontal: false, vertical: true)
            Text(tile.value)
                .font(.plexMono(.title3))
                .foregroundStyle(Palette.fg)
            if let note = tile.note {
                Text(note).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.surface)
        .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
        .clipShape(RoundedRectangle(cornerRadius: Radius.control))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tile.spoken)
    }
}

/// A chart's square panel: its title as a heading, the chart, a note under
/// it when there is one, then its caption.
private struct ChartPanel<Chart: View>: View {
    let title: String
    let caption: String
    var note: String?
    @ViewBuilder let chart: () -> Chart

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.plexSans(.body, weight: .semibold))
                .foregroundStyle(Palette.fg)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 16)
                .padding(.top, 12)
            chart().padding(.horizontal, 8)
            if let note {
                Text(note).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted).padding(.horizontal, 16)
            }
            Text(caption)
                .font(.plexSans(.subheadline))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface)
        .overlay(Rectangle().stroke(Palette.border))
    }
}
