import Charts
import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI
import UniformTypeIdentifiers

struct PaddleListView: View {
    let source: any PaddlesSource
    /// Which paddles `source` holds; a change reloads the list.
    let sourceID: String
    let isSample: Bool
    /// The account must accept changed Terms on the website (as on Android:
    /// a notice, not a block).
    let needsTerms: Bool
    let signIn: () -> Void
    /// The Terms sheet, for an account that must accept new ones.
    let openTerms: () -> Void
    /// Adding a paddle from a GPS file, and what came of it.
    let adding: AddPaddleModel
    /// What the server offers (`options`): Strava is a way to add one only
    /// when it's on.
    let options: SignInOptions
    let openFile: (URL) -> Void
    @State private var model: PaddleListModel
    @State private var path: [PaddleRow] = []
    @State private var loadedID: String?
    @State private var choosingFile = false
    @State private var openedID: String?

    init(
        source: any PaddlesSource, sourceID: String, isSample: Bool, needsTerms: Bool, signIn: @escaping () -> Void,
        openTerms: @escaping () -> Void, adding: AddPaddleModel, options: SignInOptions,
        openFile: @escaping (URL) -> Void
    ) {
        self.source = source
        self.sourceID = sourceID
        self.isSample = isSample
        self.needsTerms = needsTerms
        self.signIn = signIn
        self.openTerms = openTerms
        self.adding = adding
        self.options = options
        self.openFile = openFile
        _model = State(initialValue: PaddleListModel(source: source))
    }

    /// Any file: watch and phone apps often save FIT or GPX with no declared
    /// type, which a narrower list would grey out. The server says why it
    /// can't read one. ("Open in" from other apps is narrower: project.yml.)
    static let fileTypes: [UTType] = [.data]

    var body: some View {
        NavigationStack(path: $path) {
            content
                .background(Palette.bg)
                .navigationTitle("Paddles")
                .toolbarBackground(Palette.bg, for: .navigationBar)
                .navigationDestination(for: PaddleRow.self) { row in
                    PaddleDetailView(id: row.id, source: source)
                }
                .navigationDestination(item: $openedID) { id in
                    PaddleDetailView(id: id, source: source)
                }
                .toolbar {
                    if !isSample {
                        #if DEBUG  // until a recording can be uploaded (RecordButton)
                            ToolbarItem(placement: .topBarLeading) { RecordButton(userID: sourceID) }
                        #endif
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Add paddle") { choosingFile = true }
                                .font(.plexSans(.body))
                                .disabled(adding.isAdding)
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) { addNotice }
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: Self.fileTypes) { result in
            if case .success(let url) = result { openFile(url) }
        }
        .onChange(of: adding.state) { _, state in
            // A paddle added: show it in the list.
            if case .done(let outcome) = state, !outcome.failed { Task { await model.load() } }
            // The card appears away from VoiceOver's focus: read it out.
            if let words = state.announcement { AccessibilityNotification.Announcement(words).post() }
        }
        .task(id: sourceID) {
            // Signed in or out: back to the top, and load the other paddles.
            if let loadedID, loadedID != sourceID {
                path = []
                model = PaddleListModel(source: source)
            }
            loadedID = sourceID
            await model.load()
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
                message: options.noPaddlesYet)
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
                    TermsView.changed, id: "terms-notice",
                    action: "Read the Terms", run: openTerms)
            }
            if let logbook = model.logbook {
                Section {
                    LogbookView(logbook: logbook, inAll: model.inAll)
                        .listRowBackground(Palette.surface)
                }
            }
            if let failure = model.refreshFailure {
                Text("Couldn't refresh your paddles. \(failure)")
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
    /// Adding a file: waiting for sign-in, adding, then what came of it.
    @ViewBuilder fileprivate var addNotice: some View {
        switch adding.state {
        case .idle:
            EmptyView()
        case .waitingForSignIn:
            addCard(adding.announcement ?? "", action: "Sign in", run: signIn)
        case .adding:
            addCard(adding.announcement ?? "", busy: true)
        case .done(let outcome):
            if let id = outcome.paddleID {
                addCard(outcome.message, action: "Open paddle") {
                    adding.dismiss()
                    path = []
                    openedID = id
                }
            } else {
                addCard(outcome.message, failed: true)
            }
        }
    }

    /// Every card but "Adding…" can be closed, which forgets the file.
    fileprivate func addCard(
        _ text: String, failed: Bool = false, busy: Bool = false, action: String? = nil, run: @escaping () -> Void = {}
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(Palette.muted) }
                    Text(text)
                        .font(.plexSans(.subheadline))
                        .foregroundStyle(failed ? Palette.red : Palette.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("add-notice")
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                if !busy {
                    Button {
                        adding.dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.plexSans(.subheadline, weight: .semibold))
                            .foregroundStyle(Palette.muted)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("add-notice-close")
                }
            }
            if let action {
                Button(action: run) {
                    Text(action).font(.plexSans(.body, weight: .semibold)).frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.primary)
                .accessibilityIdentifier("add-notice-action")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Palette.surface)
        .overlay(RoundedRectangle(cornerRadius: Radius.sheet).stroke(Palette.borderStrong))
        .clipShape(RoundedRectangle(cornerRadius: Radius.sheet))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        // Rows mustn't show through the gaps around the card.
        .background(Palette.bg)
    }

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
