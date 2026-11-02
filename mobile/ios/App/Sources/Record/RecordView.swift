import Account
import DesignSystem
import Paddles
import Recorder
import SwiftUI

/// Recording a paddle on this iPhone. Started on screen; carries on with the
/// screen off, and with the screen closed (Close while recording): Paddles
/// then says "Recording · 0:12:03" and opens it again. After Stop it goes
/// back to Paddles, where the recording waits to upload.
struct RecordView: View {
    let model: RecordModel
    /// Start was pressed (a removed phone is added again then).
    let starting: () -> Void
    @State private var permission = LocationPermission()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

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
                // While recording, Hide (in the page) closes it instead.
                if model.phase != .recording {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                            .font(.plexSans(.body))
                            .accessibilityIdentifier("record-close")
                    }
                }
            }
        }
        .onChange(of: model.phase) { _, phase in
            // UI tests: a sign-out the app makes on its own, mid-recording.
            if phase == .recording, ProcessInfo.processInfo.arguments.contains("-SignOutWhileRecording") {
                NotificationCenter.default.post(name: .signOutForTest, object: nil)
            }
            // Stopped and saved: back to Paddles, where it waits to upload.
            if case .saved = phase, model.problem == nil {
                model.done()
                dismiss()
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
        case .saved:
            // Only with a problem: a clean stop goes straight back to Paddles.
            ProblemText(model.problem ?? "")
            BigButton(title: "Done", identifier: "record-done") {
                model.done()
                dismiss()
            }
        }
    }

    @ViewBuilder private var ready: some View {
        Text("Records your route and boat motion. Each recording uploads after you stop it.")
            .font(.plexSans(.body))
            .foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        if let problem = model.problem { ProblemText(problem) }
        if permission.servicesOff || permission.denied {
            Text(
                permission.servicesOff
                    ? "Location is off on this phone. Turn it on to record."
                    : "Recording needs your location all the time. Allow it in Settings."
            )
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
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .font(.plexSans(.body, weight: .semibold))
                .frame(minHeight: 44)
                .accessibilityIdentifier("record-precise-settings")
            }
            BigButton(title: "Start", identifier: "record-start") {
                Task {
                    if await permission.ask() {
                        starting()
                        model.record()
                    }
                }
            }
            .disabled(permission.asking)
        }
    }

    /// Time first, then stroke rate, the motion trace and its line, then the
    /// GPS line (the README's layout).
    @ViewBuilder private var recording: some View {
        // A failed write ends what's saved: the screen says so in place of
        // "Recording", and the clock stops.
        if let problem = model.problem {
            ProblemText(problem)
        } else {
            Text("Recording")
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(Palette.fg)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("record-recording")
            if let started = model.startedAt {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    let elapsed = context.date.timeIntervalSince(started)
                    VStack(alignment: .leading, spacing: 2) {
                        Eyebrow("TIME")
                        // Big enough to read on a deck mount at arm's length.
                        Text(Format.clock(elapsed))
                            .font(.plexMono(size: 80, relativeTo: .largeTitle, weight: .semibold))
                            .foregroundStyle(Palette.fg)
                            .lineLimit(1)
                            .minimumScaleFactor(0.4)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Time, \(Spoken.duration(elapsed))")
                    .accessibilityIdentifier("record-time")
                }
            }
        }
        VStack(alignment: .leading, spacing: 6) {
            // Live values arrive with the recorder core's later phases; until
            // then the core has none, and the screen says so.
            StatView(
                label: "STROKE RATE",
                value: model.status.live.strokeRate.map { Format.strokeRate(Double($0)) } ?? "—", sub: nil
            )
            .accessibilityLabel(
                model.status.live.strokeRate.map { "Stroke rate, \(Int($0.rounded())) strokes per minute" }
                    ?? "Stroke rate, not measured yet"
            )
            .accessibilityIdentifier("record-stroke-rate")
            if model.status.trace == nil && !PhoneRecording.hasMotionSensors {
                Text("No motion sensors on this phone, so no stroke rate")
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("record-no-motion")
            }
        }
        if model.problem == nil {
            if let trace = model.status.trace {
                VStack(alignment: .leading, spacing: 6) {
                    MotionTraceView(trace: trace)
                    motionLine(trace)
                }
            }
            gpsLine
        }
        // Hides the screen; the recording carries on, and every screen says so.
        VStack(alignment: .leading, spacing: 6) {
            Button {
                dismiss()
            } label: {
                Text("Hide").font(.plexSans(.body, weight: .semibold)).frame(minHeight: 44).padding(.horizontal, 8)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.control)
            .tint(Palette.primaryText)
            .accessibilityIdentifier("record-hide")
            Text("Recording carries on.")
                .font(.plexSans(.subheadline))
                .foregroundStyle(Palette.muted)
        }
    }

    /// Not a live region: VoiceOver hears a change once (RecordModel).
    /// Muted ("Waiting for GPS", "GPS fix"); only "GPS lost…" red.
    private var gpsLine: some View {
        let gps = GPSLine(model.status.live)
        return Text(gps.text)
            .font(.plexSans(.body))
            .foregroundStyle(gps.isWarning ? Palette.red : Palette.muted)
            .accessibilityLabel(gps.label)
            .accessibilityIdentifier("record-gps")
    }

    /// In the GPS line's style. Not a live region: VoiceOver hears entering
    /// and leaving "Couldn’t read…" once each (RecordModel).
    private func motionLine(_ trace: MotionTrace) -> some View {
        let line = MotionLine(trace.status)
        return Text(line.text)
            .font(.plexSans(.body))
            .foregroundStyle(line.isWarning ? Palette.red : Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("record-motion")
    }
}

/// The live motion trace from the recorder core, drawn as it comes: one line,
/// no axes or numbers, no smoothing or animation. Always 48 pt tall, also at
/// large text, and empty when there's nothing to draw, so nothing below it
/// moves when the sensor starts or stops. Hidden from VoiceOver: the line
/// under it says what it shows.
private struct MotionTraceView: View {
    let trace: MotionTrace

    var body: some View {
        Canvas { context, size in
            var path = Path()
            path.addLines(trace.points(in: size, inset: 1))
            context.stroke(
                path, with: .color(Palette.primaryText),
                style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .accessibilityHidden(true)
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

/// Stops only when held for 1.5 s, so a bump in a drybag doesn't end a
/// paddle. A fill sweeps across while it's held; a tap says to keep holding;
/// VoiceOver hears "Hold to stop" and has a "Stop recording" action that
/// stops at once (the contract's words). The one filled danger control: the web's
/// are outlined, but this one has to be found by feel.
private struct HoldToStopButton: View {
    let stop: () -> Void
    @State private var hint = false
    @State private var pressing = false
    @State private var stopped = false

    var body: some View {
        VStack(spacing: 8) {
            // Above the button and always there, so a tap never moves it.
            Text("Keep holding to stop.")
                .font(.plexSans(.subheadline))
                .foregroundStyle(Palette.muted)
                .opacity(hint ? 1 : 0)
                .accessibilityHidden(!hint)
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
                                .animation(pressing ? .linear(duration: 1.5) : .default, value: pressing)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.control))
                .onTapGesture { hint = true }
                .onLongPressGesture(minimumDuration: 1.5) {
                    finish()
                } onPressingChanged: { down in
                    pressing = down
                    if down { hint = false }
                }
                .sensoryFeedback(.success, trigger: stopped)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Hold to stop")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction {
                    hint = true
                    AccessibilityNotification.Announcement("Keep holding to stop, or use the Stop recording action.")
                        .post()
                }
                .accessibilityAction(named: "Stop recording") { finish() }
                .accessibilityIdentifier("record-stop")
        }
    }

    private func finish() {
        stopped = true
        stop()
    }
}
