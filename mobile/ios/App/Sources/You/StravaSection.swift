import Account
import DesignSystem
import PaddleAPI
import SwiftUI

/// Strava on the Account screen, as the website's: connect through Strava's
/// own page, auto-import new paddles, disconnect. Older paddles stay on the
/// website for now.
struct StravaSection: View {
    let strava: StravaConnection
    /// Made through Strava (its sign-in email is a placeholder): Strava is
    /// its only way in (#712).
    var signsInWithStrava = false
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

    static let disconnectConfirm =
        "New paddles stop coming in from Strava, and you can’t sign in with Strava until you connect it again."
    /// Signing in with Strava again would make a new, empty account (#712).
    static let disconnectOnlyWayIn =
        "You sign in to this account with Strava. Once it’s disconnected, you can’t sign in to this account again."

    @State private var confirmingDisconnect = false

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
                } else if !strava.needsRecentSignIn && (strava.flash == nil || strava.canTryAgain) {
                    connectButton
                    if strava.busy == .connecting { text("Connecting…", tone: Palette.muted) }
                }
            } else if let failure = strava.loadFailure {
                text(failure, tone: Palette.red)
                Button(strava.busy == nil ? "Try again" : "Checking…") { Task { await strava.load() } }
                    .disabled(strava.busy != nil)
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
                .fixedSize()
                .foregroundStyle(Palette.green)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.green.opacity(0.5)))
            if let name = status.athlete?.name {
                Text(name).foregroundStyle(Palette.fg).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("strava-connected")
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
        .listRowSeparator(.hidden, edges: .bottom)
        .listRowBackground(Palette.surface)
        // Its own row: two lines of help inside the switch's label drew the
        // audit's clip report.
        Text(Self.autoImportHelp).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityHidden(true)
            .listRowSeparator(.hidden, edges: .top)
            .listRowBackground(Palette.surface)
        // Attribution: the row above shows the athlete's Strava name.
        Image("PoweredByStrava").resizable().scaledToFit().frame(height: 20)
            .accessibilityLabel("Powered by Strava")
            .listRowBackground(Palette.surface)
        disconnectButton
        text(Self.disconnectHelp, tone: Palette.muted).listRowSeparator(.hidden, edges: .top)
    }

    /// Last, by what it does: the quieter action, next to its consequence.
    private var disconnectButton: some View {
        Button {
            confirmingDisconnect = true
        } label: {
            Text(strava.busy == .disconnecting ? "Disconnecting…" : "Disconnect").frame(minHeight: 44)
        }
        .disabled(strava.busy != nil)
        .listRowSeparator(.hidden, edges: .bottom)
        .listRowBackground(Palette.surface)
        .confirmationDialog("Disconnect Strava?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
            Button("Disconnect Strava", role: .destructive) { Task { await strava.disconnect() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(signsInWithStrava ? Self.disconnectOnlyWayIn : Self.disconnectConfirm)
        }
    }

    private func flashRow(_ flash: StravaConnection.Flash) -> some View {
        let (words, tone) =
            switch flash {
            case .done(let words): (words, Palette.green)
            case .failed(let words): (words, Palette.red)
            }
        return text(words, tone: tone).accessibilityIdentifier("strava-flash")
    }

    /// Said once per change (not on each appearance of a lazy row): the
    /// result, or that a new sign-in is needed.
    static func announcement(_ strava: StravaConnection) -> String? {
        if strava.needsRecentSignIn { return reauth }
        switch strava.flash {
        case .done(let words), .failed(let words): return words
        case nil: return nil
        }
    }

    private func text(_ words: String, tone: Color) -> some View {
        Text(words)
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
            .listRowBackground(Palette.surface)
    }
}
