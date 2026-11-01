import Account
import DesignSystem
import SwiftUI

/// Deleting the account, as the website: what goes, type DELETE, then
/// "Delete for good". A sheet, not an alert: on iOS 17 an alert's button
/// didn't follow its text field and did nothing when tapped.
struct DeleteAccountView: View {
    let account: AccountModel
    let deleted: () -> Void
    /// Sign out and sign in again, then come straight back here.
    let signInAgain: () -> Void
    /// Made with Strava, which has gone (its sign-in email is a placeholder):
    /// there's no way back in to sign in again with, so it offers Email us
    /// instead, with the Support ID. Asked before showing either; unknown
    /// shows neither, as guessing "no" would lock the account out.
    @State private var madeWithStrava = false
    /// No mail app took the Email us link: the address, as text.
    @State private var noMailApp: String?
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .checking
    @State private var confirmText = ""
    @State private var deleting = false
    @State private var failure: String?
    @Environment(\.openURL) private var openURL

    enum Step {
        case checking, needsSignIn, ready
    }

    static let needsSignIn =
        "For your safety, deleting your account needs a recent sign-in. Sign in again and you’ll come straight back here."

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch step {
                    case .checking where failure != nil:
                        Button {
                            failure = nil
                            Task { await check() }
                        } label: {
                            Text("Try again").frame(minHeight: 44)
                        }
                        .font(.plexSans(.body))
                        .foregroundStyle(Palette.primaryText)
                    case .checking:
                        ProgressView("Checking…").tint(Palette.muted).foregroundStyle(Palette.muted)
                            .frame(maxWidth: .infinity)
                    case .needsSignIn:
                        Text(madeWithStrava ? MadeWithStrava.deleteWords : Self.needsSignIn)
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.fg)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("delete-needs-sign-in")
                        Button(action: madeWithStrava ? emailUs : signInAgain) {
                            Text(madeWithStrava ? "Email us" : "Sign in again")
                                .font(.plexSans(.body, weight: .semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.primary)
                        .accessibilityHint(madeWithStrava ? "Opens Mail" : "")
                        .accessibilityIdentifier(madeWithStrava ? "delete-email-us" : "delete-sign-in-again")
                        if madeWithStrava, let noMailApp {
                            Text(noMailApp)
                                .font(.plexSans(.body))
                                .foregroundStyle(Palette.fg)
                                .textSelection(.enabled)
                                .accessibilityIdentifier("no-mail-app")
                        }
                    case .ready:
                        confirm
                    }
                    if let failure {
                        Text(failure).font(.plexSans(.body)).foregroundStyle(Palette.red)
                            .accessibilityIdentifier("delete-error")
                    }
                }
                .padding(16)
            }
            .background(Palette.bg)
            .navigationTitle("Delete your account?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(deleting)
                }
            }
            .task { await check() }
        }
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(deleting)
    }

    @ViewBuilder private var confirm: some View {
        Text(DeleteAccountWords.explained)
            .font(.plexSans(.body))
            .foregroundStyle(Palette.fg)
        VStack(alignment: .leading, spacing: 6) {
            Text("Type DELETE to confirm. There is no undo.")
                .font(.plexSans(.subheadline, weight: .medium))
                .foregroundStyle(Palette.fg)
            TextField("", text: $confirmText)
                .font(.plexSans(.body))
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Palette.surface)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                .accessibilityLabel("Type DELETE to confirm")
                .accessibilityIdentifier("confirm-delete-text")
        }
        Button(role: .destructive) {
            Task { await delete() }
        } label: {
            Text(deleting ? "Deleting…" : "Delete for good")
                .font(.plexSans(.body, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        // Red words on a faint red, as the website's danger button: white on
        // this red is too faint to read.
        .buttonStyle(.bordered)
        .tint(Palette.red)
        .disabled(confirmText != "DELETE" || deleting)
        .accessibilityIdentifier("confirm-delete-account")
    }

    /// Asked before DELETE is typed, so nobody types it in vain.
    private func check() async {
        do {
            if try await account.recentSignIn() {
                step = .ready
                failure = nil
                return
            }
        } catch {
            failure = AccountView.failure("Couldn't check your sign-in.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
            return
        }
        await needSignIn()
    }

    /// A fresh sign-in is needed: Sign in again, or Email us for an account
    /// made with Strava. Unknown is neither: Try again.
    private func needSignIn() async {
        guard let made = await account.askMadeWithStrava() else {
            step = .checking
            failure = MadeWithStrava.checkFailed
            AccessibilityNotification.Announcement(MadeWithStrava.checkFailed).post()
            return
        }
        madeWithStrava = made
        step = .needsSignIn
        failure = nil
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await account.deleteAccount()
            deleted()
        } catch AccountModel.DeleteError.needsRecentSignIn {
            // The 10 minutes ran out while they typed.
            await needSignIn()
            if step == .needsSignIn {
                AccessibilityNotification.Announcement(madeWithStrava ? MadeWithStrava.deleteWords : Self.needsSignIn)
                    .post()
            }
        } catch {
            failure = AccountView.failure("Couldn't delete your account.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }

    /// Mail to us with the Support ID the Account screen shows; with no
    /// mail app, the address and the Support ID as text.
    private func emailUs() {
        guard let id = account.user?.id else {
            noMailApp = MadeWithStrava.noMailApp()
            return
        }
        openURL(MadeWithStrava.deleteEmail(supportID: id)) { accepted in
            noMailApp = accepted ? nil : MadeWithStrava.noMailApp(supportID: id)
        }
    }
}
