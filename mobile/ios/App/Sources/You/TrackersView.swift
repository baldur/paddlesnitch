import Account
import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI

/// Devices: the account's trackers, as the website's /devices, a card each
/// in the server's order with what the server says about it. Adding one and
/// syncing over Bluetooth come with the tracker phase (P3); until then the
/// guide says how.
struct TrackersView: View {
    let account: AccountModel
    @State private var model: TrackersModel
    @State private var guide = false

    init(account: AccountModel) {
        self.account = account
        _model = State(initialValue: TrackersModel(source: ServerTrackers(client: account.client)))
    }

    var body: some View {
        content
            .background(Palette.bg)
            .navigationTitle("Devices")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.bg, for: .navigationBar)
            .task { await model.load() }
            .sheet(isPresented: $guide) {
                SafariView(url: PaddlesnitchApp.baseURL.appending(path: "guide")).ignoresSafeArea()
            }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading…").font(.plexSans(.body)).foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            MessageView(
                title: "Couldn't load your trackers", message: message,
                action: ("Try again", { Task { await model.load() } }))
        case .loaded(let cards) where cards.isEmpty:
            MessageView(
                title: "No trackers yet",
                message:
                    "A paddlesnitch tracker records your paddle and uploads it over WiFi by itself. "
                    + "Add one with the code on its screen.",
                action: ("Open the guide", { guide = true }))
        case .loaded(let cards):
            List {
                if let failure = model.refreshFailure {
                    Text("Couldn’t refresh your trackers. \(failure)")
                        .font(.plexSans(.subheadline)).foregroundStyle(Palette.red)
                        .listRowBackground(Palette.surface)
                }
                Section {
                    ForEach(cards) { card in
                        // A destination, not a value: You's path holds its own routes only.
                        NavigationLink {
                            TrackerDetailView(account: account, model: model, deviceId: card.id)
                        } label: {
                            TrackerCardView(card: card)
                        }
                        .listRowBackground(Palette.surface)
                        .accessibilityIdentifier("tracker-\(card.id)")
                    }
                } header: {
                    Text("Your trackers").font(.plexSans(.subheadline, weight: .medium))
                        .foregroundStyle(Palette.muted).textCase(nil)
                } footer: {
                    Text("Each tracker’s paddles appear in Paddles by themselves. To remove a tracker, open it.")
                        .font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .refreshable { await model.load() }
        }
    }
}

/// A card's lines: the name, the status in its colours, the recordings,
/// and the id for support, last and small.
struct TrackerCardView: View {
    let card: TrackerCard

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(card.name).font(.plexSans(.body, weight: .medium)).foregroundStyle(Palette.fg)
                if card.removed {
                    Text("removed")
                        .font(.plexMono(.caption))
                        .foregroundStyle(Palette.muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                }
            }
            if let status = card.status {
                status.parts.reduce(Text("")) { line, part in line + Text(part.text).foregroundStyle(part.tone.color) }
                    .font(.plexMono(.subheadline))
            }
            Text(card.recordings).font(.plexMono(.subheadline)).foregroundStyle(Palette.muted)
            Text(card.identity).font(.plexMono(.caption)).foregroundStyle(Palette.muted)
        }
        .padding(.vertical, 4)
        // A sentence for VoiceOver, not the lines' codes; the id is support's.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(card.spoken)
        .accessibilityCustomContent("Tracker ID", card.identity)
    }
}

extension TrackerCard.Tone {
    var color: Color {
        switch self {
        case .muted: Palette.muted
        case .fg: Palette.fg
        case .split: Palette.split
        case .green: Palette.green
        case .red: Palette.red
        }
    }
}

/// One tracker: its card, its recordings (each paddle opens), and removing
/// it from the account, as the website's /devices/<id>.
struct TrackerDetailView: View {
    let account: AccountModel
    let model: TrackersModel
    let deviceId: String
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingRemove = false
    @State private var removing = false
    @State private var removeFailure: String?
    @AccessibilityFocusState private var questionFocused: Bool

    var body: some View {
        List {
            if let card = model.card(deviceId) {
                Section { TrackerCardView(card: card).listRowBackground(Palette.surface) }
            }
            recordings
            if model.card(deviceId)?.removed == false {
                removeSection
            } else if model.card(deviceId)?.removed == true {
                Text("This tracker is no longer on your account, but its recordings are still yours.")
                    .font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                    .listRowBackground(Palette.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.bg)
        .navigationTitle(model.card(deviceId)?.name ?? "Tracker")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.bg, for: .navigationBar)
    }

    @ViewBuilder private var recordings: some View {
        Section {
            switch model.recordingsState {
            case .loading:
                ProgressView("Loading…").tint(Palette.muted).foregroundStyle(Palette.muted)
                    .listRowBackground(Palette.surface)
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    Text("Couldn’t load the recordings. \(message)")
                        .font(.plexSans(.subheadline)).foregroundStyle(Palette.red)
                    Button {
                        Task { await model.loadRecordings() }
                    } label: {
                        Text("Try again").frame(minHeight: 44)
                    }
                }
                .listRowBackground(Palette.surface)
            case .loaded:
                let rows = model.recordings(of: deviceId) ?? []
                if rows.isEmpty {
                    Text(
                        "No recordings yet. The tracker uploads them by itself when it’s switched on in range of your WiFi."
                    )
                    .font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                    .listRowBackground(Palette.surface)
                }
                ForEach(rows) { row in
                    if let id = row.paddleID {
                        NavigationLink {
                            PaddleDetailView(id: id, source: ServerPaddles(client: account.client))
                        } label: {
                            recordingLabel(row)
                        }
                        .listRowBackground(Palette.surface)
                        .accessibilityIdentifier("recording-\(row.id)")
                    } else {
                        recordingLabel(row)
                            .listRowBackground(Palette.surface)
                            .accessibilityIdentifier("recording-\(row.id)")
                    }
                }
            }
        } header: {
            Text("Recordings").font(.plexSans(.subheadline, weight: .medium))
                .foregroundStyle(Palette.muted).textCase(nil)
        } footer: {
            Text(
                "Each paddle opens in Paddles. A recording where the boat barely moved, like a test at home, stays here."
            )
            .font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
        }
    }

    private func recordingLabel(_ row: RecordingRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // Muted when it doesn't open, so it doesn't look like it does.
            Text(row.title).font(.plexMono(.subheadline)).foregroundStyle(
                row.paddleID == nil ? Palette.muted : Palette.fg)
            Text(row.detail).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
        }
        .accessibilityElement(children: .combine)
    }

    private var removeSection: some View {
        Section {
            if confirmingRemove {
                Text("Remove this tracker? It stops uploading until you add it again. Its recordings stay yours.")
                    .font(.plexSans(.body)).foregroundStyle(Palette.fg)
                    .listRowBackground(Palette.surface)
                    // The button that was focused is gone: read the question.
                    .accessibilityFocused($questionFocused)
                    .onAppear { questionFocused = true }
                HStack(spacing: 12) {
                    Button(role: .destructive) {
                        Task { await remove() }
                    } label: {
                        Text(removing ? "Removing…" : "Remove").frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(Palette.red)
                    .accessibilityIdentifier("confirm-remove-tracker")
                    Button {
                        confirmingRemove = false
                    } label: {
                        Text("Cancel").frame(minHeight: 44)
                    }
                    .disabled(removing)
                }
                .buttonStyle(.borderless)
                .disabled(removing)
                .listRowBackground(Palette.surface)
            } else {
                Button(role: .destructive) {
                    removeFailure = nil
                    confirmingRemove = true
                } label: {
                    Text("Remove tracker").foregroundStyle(Palette.red).frame(minHeight: 44)
                }
                .listRowBackground(Palette.surface)
            }
            if let removeFailure {
                Text(removeFailure).font(.plexSans(.subheadline)).foregroundStyle(Palette.red)
                    .listRowBackground(Palette.surface)
            }
        }
    }

    private func remove() async {
        removing = true
        defer { removing = false }
        if let failure = await model.remove(deviceId) {
            removeFailure = failure
            AccessibilityNotification.Announcement(failure).post()
        } else {
            confirmingRemove = false
            AccessibilityNotification.Announcement("Tracker removed.").post()
        }
    }
}
