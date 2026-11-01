import DesignSystem
import PaddleAPI
import Paddles
import PhoneUpload
import Recorder
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
    /// Where the signed-in account's recordings from this phone go.
    let recordings: URL?
    /// This account's recordings from this phone, waiting to upload.
    let uploads: UploadQueue?
    /// The website's issue form, for a recording the server won't take:
    /// false if it couldn't open.
    let openReport: () async -> Bool
    @State private var model: PaddleListModel
    @State private var path: [PaddleRow] = []
    @State private var loadedID: String?
    @State private var choosingFile = false
    @State private var openedID: String?
    /// The recording on this phone: it outlives its screen (Close while
    /// recording) and a sign-out, and stays in the account it started in.
    @State private var recorder: RecordModel?
    @State private var showingRecord = false
    /// The account folder the recording writes to.
    @State private var recordingFolder: URL?

    init(
        source: any PaddlesSource, sourceID: String, isSample: Bool, needsTerms: Bool, signIn: @escaping () -> Void,
        openTerms: @escaping () -> Void, adding: AddPaddleModel, options: SignInOptions,
        openFile: @escaping (URL) -> Void, recordings: URL?, uploads: UploadQueue?,
        openReport: @escaping () async -> Bool
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
        self.recordings = recordings
        self.uploads = uploads
        self.openReport = openReport
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
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Record") { openRecord() }
                                .font(.plexSans(.body))
                                .accessibilityIdentifier("record")
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Add paddle") { choosingFile = true }
                                .font(.plexSans(.body))
                                .disabled(adding.isAdding)
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) { addNotice }
        }
        // Presented from Paddles itself, not from the Record button: a
        // sign-out the app makes on its own (a refused refresh) takes the
        // button away, and would take the screen and its Stop with it.
        .fullScreenCover(isPresented: $showingRecord) {
            if let recorder {
                RecordView(model: recorder) {
                    // Start adds a phone removed on Devices again.
                    if let uploads, uploads.state.removed { Task { await uploads.addAgain() } }
                }
            }
        }
        // Nothing uploads while a recording runs.
        .task(id: UploadsAndRecording(uploads: uploads, recording: isRecording)) {
            uploads?.recording = isRecording
        }
        .onChange(of: sourceID) { _, id in endRecordingOfAnother(id) }
        .onChange(of: uploads?.lines.count ?? 0) { before, after in
            // One went up: its paddle is in the list now.
            if after < before { Task { await model.load() } }
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
                .safeAreaInset(edge: .top) { pendingAbove }
        case .failed(let message):
            // Offline is when this shows, and when "Waiting to upload" matters.
            MessageView(
                title: "Couldn't load your paddles", message: message,
                action: ("Try again", { Task { await model.load() } })
            )
            .safeAreaInset(edge: .top) { pendingAbove }
        case .loaded(let rows) where rows.isEmpty && !hasPending:
            MessageView(
                title: "No paddles yet",
                message: options.noPaddlesYet)
        case .loaded(let rows):
            list(rows)
        }
    }

    private func list(_ rows: [PaddleRow]) -> some View {
        List {
            notices
            if hasPending { pending }
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
                // Not over no rows (a first recording still uploading).
                if !rows.isEmpty {
                    Text("All paddles")
                        .font(.plexSans(.subheadline, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .textCase(nil)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
    }
}

extension PaddleListView {
    fileprivate var isRecording: Bool { recorder?.phase == .recording }

    /// A recording running, or recordings waiting to upload.
    fileprivate var hasPending: Bool { isRecording || !(uploads?.lines.isEmpty ?? true) }

    /// Samples, or Terms to accept.
    @ViewBuilder fileprivate var notices: some View {
        if isSample {
            notice(
                "These are sample paddles. Sign in to see yours.", id: "sample-notice", action: "Sign in",
                run: signIn)
        }
        if needsTerms {
            notice(TermsView.changed, id: "terms-notice", action: "Read the Terms", run: openTerms)
        }
    }

    /// The recording running, and the recordings waiting to upload.
    fileprivate var pending: some View {
        Section {
            if isRecording, let started = recorder?.startedAt {
                RecordingLine(startedAt: started) { showingRecord = true }
                    .listRowBackground(Palette.surface)
            }
            if let uploads {
                ForEach(uploads.lines) { line in
                    UploadLineView(line: line, queue: uploads, openReport: openReport)
                }
            }
        }
    }

    /// A recording keeps going through a sign-out the app makes on its own
    /// (a refused refresh), in the account it started in. It ends when that
    /// account is deleted (its files go too) or another one signs in.
    fileprivate func endRecordingOfAnother(_ id: String) {
        guard isRecording, let folder = recordingFolder else { return }
        let deleted = !FileManager.default.fileExists(atPath: folder.path(percentEncoded: false))
        guard deleted || (recordings != nil && recordings != folder) else { return }
        showingRecord = false
        recorder?.stop()
        recorder?.done()
        if deleted { try? FileManager.default.removeItem(at: folder) }
    }

    /// The same lines over a list that's loading or failed to load.
    @ViewBuilder fileprivate var pendingAbove: some View {
        if hasPending {
            VStack(alignment: .leading, spacing: 8) {
                if isRecording, let started = recorder?.startedAt {
                    RecordingLine(startedAt: started) { showingRecord = true }
                }
                if let uploads {
                    ForEach(uploads.lines) { line in
                        UploadLineView(line: line, queue: uploads, openReport: openReport)
                    }
                }
            }
            .padding(16)
            .background(Palette.surface)
        }
    }

    /// Opens the record screen: the running recording, or a new one in the
    /// signed-in account's own folder, fixed now.
    fileprivate func openRecord() {
        if !isRecording {
            guard let folder = recordings else { return }
            recordingFolder = folder
            recorder = RecordModel(
                announce: { AccessibilityNotification.Announcement($0).post() },
                start: { onStatus in
                    let recording = try PhoneRecording(directory: folder, onStatus: onStatus)
                    return (recording, recording.files.track.lastPathComponent)
                })
        }
        showingRecord = true
    }

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

/// Re-runs the task that tells the queue a recording runs, for a new queue
/// (another sign-in) as well as a change.
private struct UploadsAndRecording: Equatable {
    let queue: ObjectIdentifier?
    let recording: Bool

    @MainActor init(uploads: UploadQueue?, recording: Bool) {
        queue = uploads.map(ObjectIdentifier.init)
        self.recording = recording
    }
}
