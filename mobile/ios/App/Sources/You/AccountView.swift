import Account
import DesignSystem
import PaddleAPI
import Paddles
import SampleServer
import SwiftUI

/// The account, native in the app (mobile-apps.md, the owner's 2026-10-25
/// note), in the website's order: the Terms when they've changed, your
/// details, public profile, your data, then delete. Words follow the
/// website's account page.
struct AccountView: View {
    let account: AccountModel
    /// Opens the sign-in sheet.
    let signIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var termsChanged = false
    @State private var downloading = false
    @State private var downloaded: SharedFile?
    @State private var downloadFailure: String?
    @State private var confirmingDelete = false
    @State private var webPage: YouView.WebPage?
    @State private var profile: ProfileForm

    init(account: AccountModel, signIn: @escaping () -> Void) {
        self.account = account
        self.signIn = signIn
        _profile = State(initialValue: ProfileForm(account: account))
    }

    struct SharedFile: Identifiable {
        let url: URL
        var id: URL { url }
    }

    /// Under the button. Short: a row several screens tall at the largest
    /// text size left the List blank (LargeTextTests).
    static let deleteSummary = "Deletes your account, paddles, results and tracker recordings. It can’t be undone."

    var body: some View {
        List {
            if termsChanged { termsSection }
            ProfileSections(account: account, form: profile) { title, path in
                webPage = YouView.WebPage(title: title, path: path)
            }
            // The profile arrives after the screen: its rows appear in place
            // rather than animating in (iOS 17's audit measured them mid-move).
            .transaction { $0.animation = nil }
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
                    confirmingDelete = true
                } label: {
                    Text("Delete my account").foregroundStyle(Palette.red)
                }
                .font(.plexSans(.body))
                .listRowBackground(Palette.surface)
                helper(Self.deleteSummary, failed: false)
            } header: {
                header("Delete account")
            }
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.bg)
        .navigationTitle("Account")
        // Back from signing in again to delete: on appearing (You
        // pushed this screen again), or once the sign-in sheet has finished
        // closing. A sheet asked to open while another is closing never opens
        // (iOS 17 on CI took longer than the 700 ms once waited here).
        .onAppear { resume() }
        // Again for whoever signs in, so nothing of the last account stays.
        .task(id: account.user?.id) { await profile.load() }
        .onChange(of: account.signInSheetUp) { _, up in if !up { resume() } }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Palette.bg, for: .navigationBar)
        .sheet(
            item: $downloaded, onDismiss: { account.removeDownloadedData() },
            content: { file in ShareSheet(items: [file.url]).ignoresSafeArea() }
        )
        .sheet(item: $webPage) { page in
            SafariView(url: PaddlesnitchApp.baseURL.appending(path: page.path)).ignoresSafeArea()
        }
        .sheet(isPresented: $confirmingDelete) {
            DeleteAccountView(
                account: account,
                deleted: {
                    confirmingDelete = false
                    // Back to You, which now says the account is deleted.
                    dismiss()
                },
                signInAgain: {
                    confirmingDelete = false
                    signInAgain(then: .delete)
                }
            )
            .buttonBorderShape(.control)
        }
    }

    private var termsSection: some View {
        Section {
            TermsView(account: account, onStatus: { termsChanged = !$0.accepted })
        } header: {
            header("Terms of Service")
        }
    }

    private func resume() {
        guard !account.signInSheetUp, let next = account.resumeAfterSignIn() else { return }
        switch next {
        case .delete: confirmingDelete = true
        }
    }

    private func signInAgain(then next: AccountModel.AfterSignIn) {
        Task {
            await account.signOutToSignInAgain(then: next)
            signIn()
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
                    .fixedSize(horizontal: false, vertical: true)
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
