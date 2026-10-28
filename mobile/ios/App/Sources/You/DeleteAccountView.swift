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
    /// Made through Strava, and Strava is off: there's no way back in to
    /// sign in again with, so it offers Report an issue instead.
    var cantSignInAgain = false
    let signInAgain: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .checking
    @State private var confirmText = ""
    @State private var deleting = false
    @State private var failure: String?
    /// The website's issue form, signed in as this account.
    @State private var reportPage: URL?
    @State private var openingReport = false

    enum Step {
        case checking, needsSignIn, ready
    }

    /// mobile/contract/README.md, Account: the words for this step.
    /// The contract's words: the report is public, and filed signed in.
    static let cantSignInAgainWords =
        "Strava sign-in is off for now, so you can’t sign in again here. Report an issue asking us to delete your "
        + "account. We’ll know it’s yours, so leave out your name and email: reports are public."
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
                        Text(cantSignInAgain ? Self.cantSignInAgainWords : Self.needsSignIn)
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.fg)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("delete-needs-sign-in")
                        Button(action: cantSignInAgain ? { Task { await openReport() } } : signInAgain) {
                            Text(
                                cantSignInAgain
                                    ? (openingReport ? "Report an issue…" : "Report an issue") : "Sign in again"
                            )
                            .font(.plexSans(.body, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.primary)
                        .disabled(openingReport)
                        .accessibilityHint(cantSignInAgain ? "Opens paddlesnitch.com" : "")
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
        .sheet(item: $reportPage) { url in
            SafariView(url: url).ignoresSafeArea()
        }
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(deleting)
    }

    @ViewBuilder private var confirm: some View {
        Text(AccountView.deleteExplained)
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
            step = try await account.recentSignIn() ? .ready : .needsSignIn
            failure = nil
        } catch {
            failure = AccountView.failure("Couldn't check your sign-in.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await account.deleteAccount()
            deleted()
        } catch AccountModel.DeleteError.needsRecentSignIn {
            // The 10 minutes ran out while they typed.
            step = .needsSignIn
            failure = nil
            AccessibilityNotification.Announcement(Self.needsSignIn).post()
        } catch {
            failure = AccountView.failure("Couldn't delete your account.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }

    /// Signed in through a one-time link, so the report is filed as this
    /// account.
    private func openReport() async {
        openingReport = true
        failure = nil
        defer { openingReport = false }
        do {
            reportPage = try await account.reportPage()
        } catch {
            failure = AccountView.failure("Couldn’t open the issue form.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }
}
