import Account
import DesignSystem
import PaddleAPI
import Paddles
import SwiftUI

/// The account, native in the app (mobile-apps.md, the owner's 2026-10-25
/// note), in the website's order: the Terms when they've changed, public
/// profile (still the website until it moves here too), your data, then
/// delete. Words follow the website's account page.
struct AccountView: View {
    let account: AccountModel
    @Environment(\.dismiss) private var dismiss
    @State private var termsChanged = false
    @State private var downloading = false
    @State private var downloaded: SharedFile?
    @State private var downloadFailure: String?
    @State private var confirmingDelete = false
    @State private var confirmText = ""
    @State private var deleting = false
    @State private var deleteFailure: String?
    @State private var webPage: YouView.WebPage?

    struct SharedFile: Identifiable {
        let url: URL
        var id: URL { url }
    }

    /// Under the button. Short: a row several screens tall at the largest
    /// text size left the List blank (LargeTextTests).
    static let deleteSummary = "Deletes your account, paddles, results and tracker recordings. It can't be undone."

    /// The website's account page, word for word: in the confirm step.
    static let deleteExplained =
        "Deletes your account, your paddles and diary notes, your results (leaderboards update without you), "
        + "your shared links and your tracker recordings. Courses and trials you created go too, unless a group "
        + "owns them or someone else has a result in them. Your trackers are unlinked and Strava is disconnected. "
        + "A group you own passes to one of its admins or members. This happens at once and can't be undone."

    var body: some View {
        List {
            if termsChanged { termsSection }
            Section {
                Button {
                    webPage = YouView.WebPage(title: "Public profile", path: "/account#profile")
                } label: {
                    HStack {
                        Text("Public profile").font(.plexSans(.body)).foregroundStyle(Palette.fg)
                        Spacer()
                        Image(systemName: "arrow.up.right.square").foregroundStyle(Palette.muted)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityHint("Opens paddlesnitch.com")
                .listRowBackground(Palette.surface)
            }
            Section {
                Button {
                    Task { await download() }
                } label: {
                    HStack {
                        Text(downloading ? "Downloading…" : "Download my data")
                            .foregroundStyle(Palette.primaryText)
                        Spacer()
                        if downloading { ProgressView().tint(Palette.muted).accessibilityHidden(true) }
                    }
                }
                .disabled(downloading)
                .font(.plexSans(.body))
                .listRowBackground(Palette.surface)
                helper(downloadFailure ?? "Everything we hold about you, in one file.", failed: downloadFailure != nil)
            } header: {
                header("Your data")
            }
            if !termsChanged { termsSection }
            Section {
                Button(role: .destructive) {
                    confirmText = ""
                    confirmingDelete = true
                } label: {
                    HStack {
                        Text(deleting ? "Deleting…" : "Delete my account").foregroundStyle(Palette.red)
                        Spacer()
                        if deleting { ProgressView().tint(Palette.muted).accessibilityHidden(true) }
                    }
                }
                .disabled(deleting)
                .font(.plexSans(.body))
                .listRowBackground(Palette.surface)
                helper(deleteFailure ?? Self.deleteSummary, failed: deleteFailure != nil)
            } header: {
                header("Delete account")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.bg)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.bg, for: .navigationBar)
        .sheet(
            item: $downloaded, onDismiss: { account.removeDownloadedData() },
            content: { file in ShareSheet(items: [file.url]).ignoresSafeArea() }
        )
        .sheet(item: $webPage) { page in
            SafariView(url: PaddlesnitchApp.baseURL.appending(path: page.path)).ignoresSafeArea()
        }
        // As the website: type DELETE, then "Delete for good".
        .alert("Delete your account?", isPresented: $confirmingDelete) {
            TextField("DELETE", text: $confirmText)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button("Delete for good", role: .destructive) { Task { await delete() } }
                .disabled(confirmText != "DELETE")
                .accessibilityIdentifier("confirm-delete-account")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(Self.deleteExplained + "\n\nType DELETE to confirm. There is no undo.")
        }
    }

    private var termsSection: some View {
        Section {
            TermsView(account: account, onStatus: { termsChanged = !$0.accepted })
        } header: {
            header("Terms of Service")
        }
    }

    private func download() async {
        downloading = true
        defer { downloading = false }
        do {
            downloaded = SharedFile(url: try await account.downloadData())
            downloadFailure = nil
        } catch {
            downloadFailure = Self.failure("Couldn't download your data.", error)
            AccessibilityNotification.Announcement(downloadFailure ?? "").post()
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await account.deleteAccount()
            // Back to You, which now says the account is deleted.
            dismiss()
        } catch {
            deleteFailure = Self.failure("Couldn't delete your account.", error)
            AccessibilityNotification.Announcement(deleteFailure ?? "").post()
        }
    }

    /// "Couldn't …" with what to do: the server's words when it gave some.
    static func failure(_ what: String, _ error: any Error) -> String {
        switch error {
        case PaddleAPIError.rejected(let message, _, _): message
        case PaddleAPIError.signedOut: "\(what) Please sign in again."
        case is URLError: "\(what) Check your connection and try again."
        default: "\(what) Please try again."
        }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.muted).textCase(nil)
    }

    private func helper(_ text: String, failed: Bool) -> some View {
        Text(text)
            .font(.plexSans(.subheadline))
            .foregroundStyle(failed ? Palette.red : Palette.muted)
            .listRowBackground(Palette.surface)
    }
}

/// Whether this account has accepted the current Terms, and accepting them
/// as the website does: read them, tick that you agree to the Terms and the
/// Privacy Policy, accept. On the Account screen, and in a sheet from the
/// Paddles notice.
struct TermsView: View {
    let account: AccountModel
    var onStatus: (TosStatus) -> Void = { _ in }
    var accepted: () -> Void = {}
    @State private var status: TosStatus?
    @State private var failure: String?
    @State private var agreed = false
    @State private var accepting = false
    @State private var reading: YouView.WebPage?

    /// Said on the Paddles notice too.
    static let changed = "The Terms of Service have changed. Please read and accept them."

    var body: some View {
        Group {
            if let status, status.accepted {
                Text(acceptedLine(status))
                    .foregroundStyle(Palette.fg)
                    .accessibilityIdentifier("account-terms")
            } else if status != nil {
                VStack(alignment: .leading, spacing: 12) {
                    Text(Self.changed)
                        .foregroundStyle(Palette.fg)
                        .accessibilityIdentifier("account-terms")
                    readButton("Read the Terms", path: "/terms")
                    readButton("Read the Privacy Policy", path: "/privacy")
                    Toggle(isOn: $agreed) {
                        Text("I have read and agree to the Terms of Service and Privacy Policy")
                            .foregroundStyle(Palette.fg)
                    }
                    .tint(Palette.primary)
                    .accessibilityIdentifier("terms-agree")
                    Button {
                        Task { await accept() }
                    } label: {
                        Text(accepting ? "Accepting…" : "Accept the Terms").font(.plexSans(.body, weight: .semibold))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.primary)
                    .disabled(!agreed || accepting)
                    if let failure { Text(failure).foregroundStyle(Palette.red) }
                }
            } else if let failure {
                VStack(alignment: .leading, spacing: 12) {
                    Text(failure).foregroundStyle(Palette.red).accessibilityIdentifier("account-terms")
                    Button {
                        Task { await load() }
                    } label: {
                        Text("Try again").frame(minHeight: 44)
                    }
                }
            } else {
                ProgressView("Loading the Terms…").tint(Palette.muted).foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity)
            }
        }
        .font(.plexSans(.body))
        .listRowBackground(Palette.surface)
        .task { await load() }
        .sheet(item: $reading) { page in
            SafariView(url: PaddlesnitchApp.baseURL.appending(path: page.path)).ignoresSafeArea()
        }
    }

    private func readButton(_ title: String, path: String) -> some View {
        Button {
            reading = YouView.WebPage(title: title, path: path)
        } label: {
            Text(title).frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(Palette.primaryText)
        .accessibilityHint("Opens paddlesnitch.com")
    }

    /// "You accepted the Terms of Service on Sun, 13 Sep 2026."
    private func acceptedLine(_ status: TosStatus) -> String {
        guard let when = status.acceptances.last(where: { $0.version == status.currentVersion })?.acceptedAt else {
            return "You've accepted the current Terms of Service."
        }
        return "You accepted the Terms of Service on \(Format.weekday(when))."
    }

    private func load() async {
        do {
            let status = try await account.termsStatus()
            self.status = status
            failure = nil
            onStatus(status)
        } catch {
            failure = AccountView.failure("Couldn't load the Terms.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }

    private func accept() async {
        accepting = true
        defer { accepting = false }
        do {
            try await account.acceptTerms()
            failure = nil
            await load()
            accepted()
        } catch {
            failure = AccountView.failure("Couldn't accept the Terms.", error)
            AccessibilityNotification.Announcement(failure ?? "").post()
        }
    }
}

/// The system share sheet: Save to Files, AirDrop, Mail.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
