import DesignSystem
import Paddles
import SwiftUI

/// Another recording of the same outing, opening Compare on the website
/// (mobile/contract/README.md, "Same outing"): a row inside the paddle's
/// card, or a link on its page. While web-code is asked it shows a spinner
/// and takes no more taps (each code works once).
struct SameOutingButton: View {
    enum Style {
        /// "Also recorded by the phone" … "Compare →", in the card.
        case row
        /// "Also recorded by the phone →", on the paddle page.
        case link
    }

    let link: SameOutingLink
    let style: Style
    /// Asks web-code and opens Compare; false if it couldn't.
    let open: () async -> Bool
    @State private var opening = false
    @State private var failed = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button {
            opening = true
            Task {
                failed = await !open()
                opening = false
            }
        } label: {
            label
                .font(.plexSans(.subheadline))
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(opening)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(link.spoken)
        .accessibilityAddTraits(.isButton)
        .alert("Couldn't open Compare. Please try again.", isPresented: $failed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private var label: some View {
        switch style {
        case .row:
            // Stacked at accessibility sizes, so neither side is squeezed.
            let layout =
                typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
            layout {
                Text(link.text)
                    .foregroundStyle(Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                HStack(spacing: 8) {
                    if opening { ProgressView().tint(Palette.muted) }
                    Text("Compare →").foregroundStyle(Palette.primaryText)
                }
            }
        case .link:
            HStack(spacing: 8) {
                Text("\(link.text) →")
                    .foregroundStyle(Palette.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if opening { ProgressView().tint(Palette.muted) }
            }
        }
    }
}
