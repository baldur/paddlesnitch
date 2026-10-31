import Account
import CoreLocation
import DesignSystem
import Paddles
import Recorder
import SwiftUI

/// Recording a paddle on this iPhone. Started on screen; carries on with the
/// screen off. The files stay on the phone until uploading arrives (P2).
struct RecordView: View {
    @State private var model: RecordModel
    @State private var permission = LocationPermission()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// - Parameter directory: the signed-in account's own folder
    ///   (`AccountModel.recordings(for:)`).
    init(directory: URL) {
        _model = State(
            initialValue: RecordModel(
                announce: { AccessibilityNotification.Announcement($0).post() },
                start: { onStatus in
                    let recording = try PhoneRecording(directory: directory, onStatus: onStatus)
                    return (recording, recording.files.track.lastPathComponent)
                }))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) { content }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Always in the same place under the thumb, at any text size.
            .safeAreaInset(edge: .bottom) {
                if model.phase == .recording {
                    HoldToStopButton { model.stop() }
                        .padding(16)
                        .background(Palette.bg)
                }
            }
            .background(Palette.bg)
            .navigationTitle("Record")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Palette.bg, for: .navigationBar)
            .toolbar {
                if model.phase != .recording {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }.font(.plexSans(.body))
                    }
                }
            }
        }
        .interactiveDismissDisabled(model.phase == .recording)
        // Never a recording without its screen: if it goes, what's recorded
        // is saved.
        .onDisappear { model.stop() }
        .onChange(of: model.phase) { _, phase in
            // UI tests: a sign-out the app makes on its own, mid-recording.
            if phase == .recording, ProcessInfo.processInfo.arguments.contains("-SignOutWhileRecording") {
                NotificationCenter.default.post(name: .signOutForTest, object: nil)
            }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .ready:
            ready
        case .recording:
            recording
        case .saved(let name):
            if let problem = model.problem {
                ProblemText(problem)
            } else {
                Text("Saved on this iPhone")
                    .font(.plexSans(.title3, weight: .semibold))
                    .foregroundStyle(Palette.fg)
            }
            Text("Uploading a recording comes in a later version. This one is kept as \(name).")
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            BigButton(title: "Done", identifier: "record-done") {
                model.done()
                dismiss()
            }
        }
    }

    @ViewBuilder private var ready: some View {
        Text("Records your route and the boat's motion. Start here, then lock the screen. Recording carries on.")
            .font(.plexSans(.body))
            .foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        if let problem = model.problem { ProblemText(problem) }
        if permission.denied {
            Text("Recording needs your location. Turn it on for paddlesnitch in Settings.")
                .font(.plexSans(.body))
                .foregroundStyle(Palette.fg)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("record-location-off")
            BigButton(title: "Open Settings", identifier: "record-settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        } else {
            if permission.reducedAccuracy {
                Text("Turn on Precise Location for paddlesnitch in Settings, or the route will be rough.")
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.fg)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("record-precise-off")
            }
            BigButton(title: "Start", identifier: "record-start") {
                Task {
                    if await permission.ask() { model.record() }
                }
            }
            .disabled(permission.asking)
        }
    }

    @ViewBuilder private var recording: some View {
        // A failed write ends what's saved: the screen says so in place of
        // "Recording", and the clock stops.
        if let problem = model.problem {
            ProblemText(problem)
        } else {
            Text("Recording")
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(Palette.fg)
                .accessibilityIdentifier("record-recording")
            let gps = GPSLine(model.status.live)
            // Not a live region: VoiceOver hears a change once (RecordModel).
            Text(gps.text)
                .font(.plexSans(.body))
                .foregroundStyle(gps.state == .fix ? Palette.green : gps.state == .lost ? Palette.red : Palette.muted)
                .accessibilityLabel(gps.label)
                .accessibilityIdentifier("record-gps")
            if let started = model.startedAt {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    VStack(alignment: .leading, spacing: 2) {
                        Eyebrow("TIME")
                        Text(Format.clock(context.date.timeIntervalSince(started)))
                            .font(.plexMono(.largeTitle, weight: .semibold))
                            .foregroundStyle(Palette.fg)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("record-time")
                }
            }
        }
        // Live values arrive with the recorder core's later phases; until
        // then the core has none, and the screen says so.
        StatView(
            label: "STROKE RATE", value: model.status.live.strokeRate.map { Format.strokeRate(Double($0)) } ?? "—",
            sub: nil
        )
        .accessibilityIdentifier("record-stroke-rate")
    }
}

/// Opens the record screen, on Paddles when signed in. Debug builds only
/// until a recording can be uploaded (C3): nobody should record a paddle
/// that goes nowhere. The account's folder is fixed here, when it opens.
struct RecordButton: View {
    let userID: String
    @Binding var folder: URL?

    init(_ userID: String, _ folder: Binding<URL?>) {
        self.userID = userID
        _folder = folder
    }

    var body: some View {
        Button("Record") { folder = AccountModel.recordings(for: userID) }
            .font(.plexSans(.body))
            .accessibilityIdentifier("record")
    }
}

extension View {
    /// The record screen, presented from Paddles itself and not from the
    /// Record button: a sign-out the app makes on its own (a refresh the
    /// server refuses, after a password reset elsewhere) takes the button
    /// away, and with it a screen it presented, mid-paddle.
    func recordScreen(_ folder: Binding<URL?>) -> some View {
        fullScreenCover(
            isPresented: Binding(get: { folder.wrappedValue != nil }, set: { if !$0 { folder.wrappedValue = nil } })
        ) {
            if let directory = folder.wrappedValue { RecordView(directory: directory) }
        }
    }
}

extension Notification.Name {
    /// UI tests only (`-SignOutWhileRecording`, with the sample server).
    static let signOutForTest = Notification.Name("SignOutForTest")
}

/// What went wrong, in place of the heading.
private struct ProblemText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.plexSans(.title3, weight: .semibold))
            .foregroundStyle(Palette.red)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("record-problem")
    }
}

/// A full-width filled button, big enough for wet hands.
private struct BigButton: View {
    let title: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.plexSans(.title3, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.borderedProminent)
        .tint(Palette.primary)
        .accessibilityIdentifier(identifier)
    }
}

/// Stops only when held for a second, so a bump in a drybag doesn't end a
/// paddle. A fill sweeps across while it's held; a tap says to hold;
/// VoiceOver's activate stops it. The one filled danger control: the web's
/// are outlined, but this one has to be found by feel.
private struct HoldToStopButton: View {
    let stop: () -> Void
    @State private var hint = false
    @State private var pressing = false
    @State private var stopped = false

    var body: some View {
        VStack(spacing: 8) {
            Text("Hold to stop")
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(Palette.bg)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(alignment: .leading) {
                    GeometryReader { box in
                        ZStack(alignment: .leading) {
                            Palette.red
                            Palette.fg.opacity(0.35)
                                .frame(width: pressing ? box.size.width : 0)
                                .animation(pressing ? .linear(duration: 1) : .default, value: pressing)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.control))
                .onTapGesture { hint = true }
                .onLongPressGesture(minimumDuration: 1) {
                    finish()
                } onPressingChanged: { down in
                    pressing = down
                    if down { hint = false }
                }
                .sensoryFeedback(.success, trigger: stopped)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Stop")
                .accessibilityHint("Stops the recording")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { finish() }
                .accessibilityIdentifier("record-stop")
            if hint {
                Text("Keep your finger on it for a second.")
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
            }
        }
    }

    private func finish() {
        stopped = true
        stop()
    }
}

/// "While Using" location permission, never "Always" (docs/features/ios-app.md).
@MainActor @Observable
final class LocationPermission: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<Bool, Never>?
    private(set) var denied = false
    /// Precise Location is off: the route would be kilometres out.
    private(set) var reducedAccuracy = false
    /// The system's question is up.
    private(set) var asking = false

    override init() {
        super.init()
        manager.delegate = self
        denied = Self.isDenied(manager.authorizationStatus)
        reducedAccuracy = manager.accuracyAuthorization == .reducedAccuracy
    }

    /// True once recording may use the location.
    func ask() async -> Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return true
        case .notDetermined:
            guard waiting == nil else { return false }  // a second tap while asking
            asking = true
            defer { asking = false }
            return await withCheckedContinuation { continuation in
                waiting = continuation
                manager.requestWhenInUseAuthorization()
            }
        default:
            denied = true
            return false
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let reduced = manager.accuracyAuthorization == .reducedAccuracy
        Task { @MainActor in self.changed(status, reduced: reduced) }
    }

    private func changed(_ status: CLAuthorizationStatus, reduced: Bool) {
        denied = Self.isDenied(status)
        reducedAccuracy = reduced
        guard status != .notDetermined, let waiting else { return }
        self.waiting = nil
        waiting.resume(returning: !denied)
    }

    private static func isDenied(_ status: CLAuthorizationStatus) -> Bool {
        status == .denied || status == .restricted
    }
}
