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
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint("Opens the recording")
        .accessibilityIdentifier("recording-line")
    }
}

/// One recording waiting to upload, or what came of one
/// (mobile/contract/README.md § After Stop).
struct UploadLineView: View {
    let line: UploadQueue.Line
    let queue: UploadQueue
    let openReport: () -> Void
    @State private var adding = false

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
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("upload-line-close")
                }
            }
            switch line {
            case .removed:
                action(adding ? "Upload now…" : "Upload now") {
                    adding = true
                    Task {
                        await queue.addAgain()
                        adding = false
                    }
                }
                .disabled(adding)
            case .refused:
                action("Report an issue", run: openReport)
            case .waiting, .noFix, .cannotAdd:
                EmptyView()
            }
        }
        .listRowBackground(Palette.surface)
    }

    private var tone: Color {
        switch line {
        case .refused, .removed, .cannotAdd: Palette.red
        case .waiting, .noFix: Palette.fg
        }
    }

    private func action(_ title: String, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title).font(.plexSans(.body, weight: .semibold)).frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(Palette.primaryText)
        .accessibilityIdentifier("upload-line-action")
    }
}
