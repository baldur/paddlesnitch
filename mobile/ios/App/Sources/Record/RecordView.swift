import CoreLocation
import DesignSystem
import Paddles
import Recorder
import SwiftUI

/// Recording a paddle on this iPhone. Started on screen; carries on with the
/// screen off. The files stay on the phone until uploading arrives (P2).
struct RecordView: View {
    @State private var model = RecordModel { onStatus in
        let recording = try PhoneRecording(directory: RecordView.directory, onStatus: onStatus)
        return (recording, recording.files.track.lastPathComponent)
    }
    @State private var permission = LocationPermission()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// Documents/Recordings: kept, and visible to the app only.
    static var directory: URL {
        URL.documentsDirectory.appending(path: "Recordings")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    content
                    if let problem = model.problem {
                        Text(problem)
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("record-problem")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
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
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .ready:
            ready
        case .recording:
            recording
        case .saved(let name):
            Text("Saved on this iPhone")
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(Palette.fg)
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
        Text("Records your route and the boat's motion. Keep the app open, then lock the screen: it carries on.")
            .font(.plexSans(.body))
            .foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
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
            BigButton(title: "Start", identifier: "record-start") {
                Task {
                    if await permission.ask() { model.record() }
                }
            }
        }
    }

    @ViewBuilder private var recording: some View {
        Text("Recording")
            .font(.plexSans(.title3, weight: .semibold))
            .foregroundStyle(Palette.fg)
            .accessibilityIdentifier("record-recording")
        Text(model.status.hasFix ? "GPS: on" : "GPS: waiting for a fix")
            .font(.plexSans(.body))
            .foregroundStyle(model.status.hasFix ? Palette.green : Palette.muted)
            .accessibilityIdentifier("record-gps")
        if let started = model.startedAt {
            TimelineView(.periodic(from: started, by: 1)) { context in
                StatView(label: "TIME", value: Format.clock(context.date.timeIntervalSince(started)), sub: nil)
                    .accessibilityIdentifier("record-time")
            }
        }
        // Live values arrive with the recorder core's later phases; until
        // then the core has none, and the screen says so.
        StatView(
            label: "STROKE RATE", value: model.status.live.strokeRate.map { Format.strokeRate(Double($0)) } ?? "—",
            sub: nil
        )
        .accessibilityIdentifier("record-stroke-rate")
        HoldToStopButton { model.stop() }
    }
}

/// Opens the record screen, on Paddles when signed in. Debug builds only
/// until a recording can be uploaded (C3): nobody should record a paddle
/// that goes nowhere.
struct RecordButton: View {
    @State private var open = false

    var body: some View {
        Button("Record") { open = true }
            .font(.plexSans(.body))
            .accessibilityIdentifier("record")
            .fullScreenCover(isPresented: $open) { RecordView() }
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
/// paddle. A tap says to hold; VoiceOver's activate stops it.
private struct HoldToStopButton: View {
    let stop: () -> Void
    @State private var hint = false

    var body: some View {
        VStack(spacing: 8) {
            Text("Hold to stop")
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(Palette.red.opacity(0.85), in: RoundedRectangle(cornerRadius: Radius.control))
                .onTapGesture { hint = true }
                .onLongPressGesture(minimumDuration: 1) { stop() }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Stop")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { stop() }
                .accessibilityIdentifier("record-stop")
            if hint {
                Text("Keep your finger on it for a second.")
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
            }
        }
    }
}

/// "While Using" location permission, never "Always" (docs/features/ios-app.md).
@MainActor @Observable
final class LocationPermission: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<Bool, Never>?
    private(set) var denied = false

    override init() {
        super.init()
        manager.delegate = self
        denied = Self.isDenied(manager.authorizationStatus)
    }

    /// True once recording may use the location.
    func ask() async -> Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return true
        case .notDetermined:
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
        Task { @MainActor in self.changed(status) }
    }

    private func changed(_ status: CLAuthorizationStatus) {
        denied = Self.isDenied(status)
        guard status != .notDetermined, let waiting else { return }
        self.waiting = nil
        waiting.resume(returning: !denied)
    }

    private static func isDenied(_ status: CLAuthorizationStatus) -> Bool {
        status == .denied || status == .restricted
    }
}
