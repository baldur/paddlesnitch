import Charts
import DesignSystem
import Paddles
import SwiftUI

struct PaddleListView: View {
    let source: any PaddlesSource
    let isSample: Bool
    /// The account must accept changed Terms on the website (as on Android:
    /// a notice, not a block).
    let needsTerms: Bool
    let signIn: () -> Void
    @State private var model: PaddleListModel
    @State private var path: [PaddleRow] = []
    @State private var termsOpen = false

    init(source: any PaddlesSource, isSample: Bool, needsTerms: Bool, signIn: @escaping () -> Void) {
        self.source = source
        self.isSample = isSample
        self.needsTerms = needsTerms
        self.signIn = signIn
        _model = State(initialValue: PaddleListModel(source: source))
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .background(Palette.bg)
                .navigationTitle("Paddles")
                .toolbarBackground(Palette.bg, for: .navigationBar)
                .navigationDestination(for: PaddleRow.self) { row in
                    PaddleDetailView(id: row.id, source: source)
                }
        }
        .task { await model.load() }
        .sheet(isPresented: $termsOpen) {
            SafariView(url: PaddlesnitchApp.baseURL.appending(path: "terms/accept")).ignoresSafeArea()
        }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading your paddles")
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            MessageView(
                title: "Couldn't load your paddles", message: message,
                action: ("Try again", { Task { await model.load() } }))
        case .loaded(let rows) where rows.isEmpty:
            MessageView(
                title: "No paddles yet",
                message: "Add one from a GPS file, Strava or a time trial. A tracker adds its own.")
        case .loaded(let rows):
            list(rows)
        }
    }

    private func list(_ rows: [PaddleRow]) -> some View {
        List {
            if isSample {
                notice(
                    "These are sample paddles. Sign in to see yours.", id: "sample-notice", action: "Sign in",
                    run: signIn)
            }
            if needsTerms {
                notice(
                    "The Terms of Service have changed. Please accept them on paddlesnitch.com.", id: "terms-notice",
                    action: "Open the Terms", run: { termsOpen = true })
            }
            if let logbook = model.logbook {
                Section {
                    LogbookView(logbook: logbook, inAll: model.inAll)
                        .listRowBackground(Palette.surface)
                }
            }
            if let failure = model.refreshFailure {
                Text(failure)
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.red)
                    .listRowBackground(Palette.surface)
            }
            Section {
                ForEach(rows) { row in
                    // A button, not a NavigationLink: the system's chevron is
                    // too faint on our surface (the accessibility audit says
                    // so), so the row draws the web's own.
                    Button {
                        path.append(row)
                    } label: {
                        PaddleRowView(row: row)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(.isLink)
                    .listRowBackground(Palette.surface)
                    .accessibilityIdentifier("paddle-\(row.id)")
                    // Compare arrives with P4; until then the row says the
                    // outing has another recording.
                    ForEach(row.alsoRecordedBy, id: \.self) { line in
                        Text(line)
                            .font(.plexSans(.subheadline))
                            .foregroundStyle(Palette.muted)
                            .listRowBackground(Palette.surface)
                    }
                }
            } header: {
                Text("All paddles")
                    .font(.plexSans(.subheadline, weight: .medium))
                    .foregroundStyle(Palette.muted)
                    .textCase(nil)
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
    }
}

extension PaddleListView {
    /// A notice with one action. `id` marks the text, and `id-action` the
    /// button (an identifier on the section would land on both).
    fileprivate func notice(_ text: String, id: String, action: String, run: @escaping () -> Void) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Text(text)
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
                    .accessibilityIdentifier(id)
                Button(action: run) {
                    Text(action).font(.plexSans(.body, weight: .semibold)).frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.primary)
                .accessibilityIdentifier("\(id)-action")
            }
            .padding(.vertical, 4)
            .listRowBackground(Palette.surface)
        }
    }
}

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

    /// "Sun, 13 Sep 2026 · Tracker" in muted, then " · K1" in the split colour.
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
struct NoGpsTag: View {
    var body: some View {
        Text("NO GPS")
            .font(.plexMono(.caption, weight: .medium))
            .foregroundStyle(Palette.muted)
            .frame(width: 64, height: 64)
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
