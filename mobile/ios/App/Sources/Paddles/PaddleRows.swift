import Charts
import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI

struct PaddleRowView: View {
    let row: PaddleRow
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // At accessibility text sizes the thumbnail goes above the words, so
        // the words get the whole width.
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
        layout {
            if row.noGps {
                NoGpsTag()
            } else {
                RouteThumb(route: row.route)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(heading)
                    .font(.plexSans(.subheadline))
                Text(row.headline)
                    .font(.plexMono(.body, weight: .semibold))
                    .foregroundStyle(Palette.fg)
                Text(row.detail)
                    .font(.plexMono(.subheadline))
                    .foregroundStyle(Palette.muted)
                if let note = row.note {
                    Text(note)
                        .font(.plexSans(.subheadline))
                        .foregroundStyle(Palette.split)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.plexSans(.subheadline, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// "Sun, 13 Sep 2026 · Tracker" (or Phone) in muted, then " · K1" in the split colour.
    private var heading: AttributedString {
        var text = AttributedString(row.heading)
        text.foregroundColor = Palette.muted
        if let boatClass = row.boatClass {
            var boat = AttributedString(" · \(boatClass)")
            boat.foregroundColor = Palette.split
            text += boat
        }
        return text
    }
}

/// In place of a route for a paddle without GPS: the web's `NoGpsTag`.
/// At least the thumbnail's 64 pt, and bigger when the text is: a fixed box
/// cut the words to "N…" at the largest text sizes.
struct NoGpsTag: View {
    var body: some View {
        Text("NO GPS")
            .font(.plexMono(.caption, weight: .medium))
            .foregroundStyle(Palette.muted)
            .multilineTextAlignment(.center)
            .padding(6)
            .frame(minWidth: 64, minHeight: 64)
            .background(Palette.bg)
            .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
            .clipShape(RoundedRectangle(cornerRadius: Radius.control))
            .accessibilityLabel("No GPS")
    }
}

/// The logbook card: this week, this month, the streak, and the last twelve
/// weeks as bars.
struct LogbookView: View {
    let logbook: LogbookSummary
    let inAll: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var stats: [PaddleSummary.Stat] { [logbook.thisWeek, logbook.thisMonth, logbook.streak] }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Three stats side by side, or one under another from xxLarge text
            // up, where three columns cut the labels short ("THIS MONTH").
            if typeSize >= .xxLarge {
                VStack(alignment: .leading, spacing: 12) { statViews }
            } else {
                HStack(alignment: .top, spacing: 12) { statViews }
            }
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("LAST 12 WEEKS")
                if logbook.isQuiet {
                    Text("No paddles in the last 12 weeks.")
                        .font(.plexSans(.subheadline))
                        .foregroundStyle(Palette.muted)
                } else {
                    Chart(logbook.weeks, id: \.start) { week in
                        // The readable blue, not the button blue: bars need 3:1
                        // against the card. This week is drawn in the text colour.
                        BarMark(x: .value("Week", week.start), y: .value("Kilometres", week.km))
                            .foregroundStyle(week.start == logbook.weeks.last?.start ? Palette.fg : Palette.primaryText)
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .frame(height: 64)
                    .accessibilityLabel("Kilometres a week for the last 12 weeks")
                }
            }
            if let inAll {
                Text(inAll)
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
            }
        }
        .padding(.vertical, 8)
        .accessibilityIdentifier("logbook")
    }

    @ViewBuilder private var statViews: some View {
        ForEach(stats, id: \.label) { stat in
            StatView(label: stat.label.uppercased(), value: stat.value, sub: stat.sub)
        }
    }
}
