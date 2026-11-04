import DesignSystem
import Paddles
import SwiftUI

/// The balance part of boat motion on your own paddle's page
/// (mobile/contract/README.md, "Boat motion", "On the paddle"): a heading,
/// "All charts →" to the screen, then Evenness and Side-to-side roll. The
/// paddle page shows it only once the motion is in and readable.
struct BoatMotionOnPaddle: View {
    let summary: BoatMotionSummary
    let openCharts: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 12) {
                    heading
                    Spacer(minLength: 0)
                    link
                }
                VStack(alignment: .leading, spacing: 4) {
                    heading
                    link
                }
            }
            // One column at accessibility sizes, as on the screen: two
            // broke "EVENNESS" mid-word there.
            if typeSize.isAccessibilitySize {
                VStack(spacing: 8) { tiles }
            } else {
                HStack(spacing: 8) { tiles }.fixedSize(horizontal: false, vertical: true)
            }
        }
        // A container, or the id would land on (and hide) the link's.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("motion-on-paddle")
    }

    private var heading: some View {
        Text(BoatMotionWords.title)
            .font(.plexSans(.title3, weight: .semibold))
            .foregroundStyle(Palette.fg)
            .accessibilityAddTraits(.isHeader)
    }

    private var link: some View {
        Button(action: openCharts) {
            Text(BoatMotionWords.allCharts)
                .font(.plexSans(.subheadline))
                .foregroundStyle(Palette.primaryText)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // VoiceOver would say "right arrow".
        .accessibilityLabel("All charts")
        .accessibilityIdentifier("motion-all-charts")
    }

    @ViewBuilder private var tiles: some View {
        ForEach(summary.onPaddle, id: \.label) { MotionTile(tile: $0) }
    }
}
