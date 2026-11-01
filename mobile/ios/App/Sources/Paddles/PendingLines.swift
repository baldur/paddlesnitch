import DesignSystem
import Paddles
import PhoneUpload
import Recorder
import SwiftUI

/// "Recording · 0:12:03" on Paddles while the record screen is closed; a tap
/// opens it again.
struct RecordingLine: View {
    let startedAt: Date
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                HStack(spacing: 8) {
                    Circle().fill(Palette.red).frame(width: 10, height: 10).accessibilityHidden(true)
                    Text("Recording · \(Format.clock(context.date.timeIntervalSince(startedAt)))")
                        .font(.plexMono(.body, weight: .semibold))
                        .foregroundStyle(Palette.fg)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.plexSans(.subheadline, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Recording, \(Spoken.duration(context.date.timeIntervalSince(startedAt)))")
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint("Opens the record screen")
        .accessibilityIdentifier("recording-line")
    }
}

/// One recording waiting to upload, or what came of one
/// (mobile/contract/README.md § After Stop).
struct UploadLineView: View {
    let line: UploadQueue.Line
    let queue: UploadQueue
    let openReport: () async -> Bool
    @State private var adding = false
    @State private var opening = false
    @State private var reportFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    if let started = line.started(in: .current) {
                        Text(started)
                            .font(.plexSans(.subheadline))
                            .foregroundStyle(Palette.muted)
                    }
                    HStack(spacing: 8) {
                        if case .waiting(_, _, true) = line { ProgressView().tint(Palette.muted) }
                        Text(line.text)
                            .font(.plexSans(.subheadline))
                            .foregroundStyle(tone)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("upload-line")
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                if case .noFix(let stem, _) = line {
                    Button {
                        queue.dismiss(stem)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.plexSans(.subheadline, weight: .semibold))
                            .foregroundStyle(Palette.muted)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss")
                    .accessibilityIdentifier("upload-line-close")
                }
            }
            switch line {
            case .removed:
                action(adding ? "Upload now…" : "Upload now", filled: true) {
                    adding = true
                    Task {
                        await queue.addAgain()
                        adding = false
                    }
                }
                .disabled(adding)
                .accessibilityIdentifier("upload-now")
            case .refused:
                action(opening ? "Report an issue…" : "Report an issue") {
                    opening = true
                    reportFailed = false
                    Task {
                        reportFailed = await !openReport()
                        opening = false
                    }
                }
                .disabled(opening)
                .accessibilityIdentifier("report-issue")
                if reportFailed {
                    Text("Couldn’t open the issue form. Please try again.")
                        .font(.plexSans(.subheadline))
                        .foregroundStyle(Palette.red)
                }
            case .waiting, .noFix, .cannotAdd:
                EmptyView()
            }
        }
        .listRowBackground(Palette.surface)
    }

    private var tone: Color {
        switch line {
        case .refused, .cannotAdd: Palette.red
        // The owner's own choice on Devices, not a failure.
        case .waiting, .noFix, .removed: Palette.fg
        }
    }

    /// The one thing to do (Upload now) filled; the rest outlined.
    @ViewBuilder
    private func action(_ title: String, filled: Bool = false, run: @escaping () -> Void) -> some View {
        let label = Text(title).font(.plexSans(.body, weight: .semibold)).frame(minHeight: 44)
        if filled {
            Button(action: run) { label }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: Radius.control))
                .tint(Palette.primary)
        } else {
            Button(action: run) { label }
                .buttonStyle(.bordered)
                .buttonBorderShape(.roundedRectangle(radius: Radius.control))
                .tint(Palette.primaryText)
        }
    }
}

/// Times as VoiceOver should say them: "12 minutes, 3 seconds", not "0:12:03".
enum Spoken {
    static func duration(_ seconds: Double) -> String {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = seconds >= 3600 ? [.hour, .minute, .second] : [.minute, .second]
        return formatter.string(from: max(0, seconds.rounded(.down))) ?? ""
    }
}
