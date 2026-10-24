import DesignSystem
import SwiftUI

/// A short upper-case mono label over data: DISTANCE, PACE. The web's
/// `<Eyebrow>`.
struct Eyebrow: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.plexMono(.caption, weight: .medium))
            .tracking(0.6)
            .foregroundStyle(Palette.muted)
    }
}

/// A labelled number: the web's `<Stat>`.
struct StatView: View {
    let label: String
    let value: String
    let sub: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Eyebrow(label)
            Text(value)
                .font(.plexMono(.title2, weight: .semibold))
                .foregroundStyle(Palette.fg)
            if let sub {
                Text(sub)
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// A full-screen message with one action, used for empty and failed states.
struct MessageView: View {
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.plexSans(.title3, weight: .semibold))
                .foregroundStyle(Palette.fg)
            Text(message)
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
            if let action {
                Button(action.title, action: action.run)
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.primary)
                    .font(.plexSans(.body, weight: .medium))
            }
        }
        .multilineTextAlignment(.center)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
