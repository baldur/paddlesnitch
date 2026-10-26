import Account
import DesignSystem
import PaddleAPI
import SwiftUI

/// Strava on the Account screen, as the website's: connect through Strava's
/// own page, auto-import new paddles, disconnect. Older paddles stay on the
/// website for now.
struct StravaSection: View {
    let strava: StravaConnection
    let connect: () -> Void
    /// A sign-in from the last 10 minutes is needed: sign out and back in.
    let signInAgain: () -> Void

    static let explained =
        "Connect Strava to bring in your paddles and trial results without exporting files, and to sign in with "
        + "Strava. We only read your activities; we never post."
    static let reauth =
        "For your safety, connecting Strava needs a recent sign-in. Sign in again and you’ll come straight back here."
    static let autoImportHelp = "New kayak, canoe, rowing and SUP activities on Strava appear in Paddles by themselves."
    static let disconnectHelp =
        "You can also sign in with Strava. Disconnecting stops both importing and signing in with Strava."

    var body: some View {
        Section {
            text(Self.explained, tone: Palette.muted)
            if let flash = strava.flash { flashRow(flash) }
            if strava.needsRecentSignIn {
                text(Self.reauth, tone: Palette.fg).accessibilityIdentifier("strava-reauth")
                Button("Sign in again", action: signInAgain)
                    .frame(minHeight: 44)
                    .listRowBackground(Palette.surface)
            }
            if let status = strava.status {
                if status.connected {
                    connected(status)
                } else if strava.flash == nil || strava.canTryAgain {
                    connectButton
                }
            } else if let failure = strava.loadFailure {
                text(failure, tone: Palette.red)
                Button("Try again") { Task { await strava.load() } }
                    .frame(minHeight: 44)
                    .listRowBackground(Palette.surface)
            } else {
                text("Checking…", tone: Palette.muted)
            }
        } header: {
            Text("Strava").font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.muted)
                .textCase(nil)
        }
        .font(.plexSans(.body))
    }

    /// Strava's own button, unaltered (their brand guidelines).
    private var connectButton: some View {
        Button(action: connect) {
            Image("ConnectWithStrava").resizable().scaledToFit().frame(height: 48)
        }
        .buttonStyle(.plain)
        .disabled(strava.busy != nil)
        .accessibilityLabel(strava.busy == .connecting ? "Connecting Strava…" : "Connect with Strava")
        .accessibilityIdentifier("strava-connect")
        .listRowBackground(Palette.surface)
    }

    @ViewBuilder private func connected(_ status: StravaStatus) -> some View {
        // Rows of their own: at the largest text size one tall row left the
        // List blank (CLAUDE.md).
        HStack(spacing: 8) {
            Text("Connected")
                .font(.plexSans(.subheadline, weight: .medium))
                .foregroundStyle(Palette.green)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.green.opacity(0.5)))
            Text(status.athlete?.name ?? "").foregroundStyle(Palette.fg)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("strava-connected")
        .listRowBackground(Palette.surface)
        Button {
            Task { await strava.disconnect() }
        } label: {
            Text(strava.busy == .disconnecting ? "Disconnecting…" : "Disconnect").frame(minHeight: 44)
        }
        .disabled(strava.busy != nil)
        .listRowBackground(Palette.surface)
        Toggle(
            isOn: Binding(
                get: { status.autoImport ?? true },
                set: { enabled in Task { await strava.setAutoImport(enabled) } })
        ) {
            Text("Auto-import new paddles").foregroundStyle(Palette.fg)
        }
        .tint(Palette.primary)
        .disabled(strava.busy != nil)
        .accessibilityHint(Self.autoImportHelp)
        .accessibilityIdentifier("strava-auto-import")
        .listRowBackground(Palette.surface)
        // Its own row: two lines of help inside the switch's label drew the
        // audit's clip report.
        Text(Self.autoImportHelp).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityHidden(true)
            .listRowBackground(Palette.surface)
        // Attribution: the row above shows the athlete's Strava name.
        Image("PoweredByStrava").resizable().scaledToFit().frame(height: 20)
            .accessibilityLabel("Powered by Strava")
            .listRowBackground(Palette.surface)
        text(Self.disconnectHelp, tone: Palette.muted)
    }

    private func flashRow(_ flash: StravaConnection.Flash) -> some View {
        let (words, tone) =
            switch flash {
            case .done(let words): (words, Palette.green)
            case .failed(let words): (words, Palette.red)
            }
        return text(words, tone: tone)
            .accessibilityIdentifier("strava-flash")
            .onAppear { AccessibilityNotification.Announcement(words).post() }
    }

    private func text(_ words: String, tone: Color) -> some View {
        Text(words)
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
            .listRowBackground(Palette.surface)
    }
}
