import Account
import DesignSystem
import SafariServices
import SwiftUI

/// The account tab. The account itself is native (AccountView); the public
/// profile and the reading pages (privacy, terms) open the website.
struct YouView: View {
    let account: AccountModel
    let signIn: () -> Void
    @State private var confirmingSignOut = false
    /// Made with Strava: an alert, so Cancel shows (iOS 26 draws a dialog as
    /// a popover without one).
    @State private var warningSignOut = false
    /// Couldn't tell whether the account was made with Strava: no sign-out
    /// until it's known (signing out could lock it out).
    @State private var signOutCheckFailed = false
    @State private var checkingSignOut = false
    /// No mail app took the Email us link: the address, as text.
    @State private var noMailApp: String?
    @Environment(\.openURL) private var openURL

    struct WebPage: Identifiable {
        let title: String
        let path: String
        var id: String { path }
    }

    static let about = [
        WebPage(title: "Privacy policy", path: "/privacy"),
        WebPage(title: "Terms of Service", path: "/terms"),
    ]

    @State private var open: WebPage?
    /// Type-erased, so Devices can push its own routes (a tracker, a
    /// paddle) with destinations it declares.
    @State private var path = NavigationPath()

    enum Route: Hashable {
        case account, trackers
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section("Account") {
                    if let user = account.user {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName).font(.plexSans(.body, weight: .semibold)).foregroundStyle(Palette.fg)
                            Text(user.email).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("signed-in-as")
                        .listRowBackground(Palette.surface)
                        NavigationLink(value: Route.account) {
                            Text("Account").font(.plexSans(.body)).foregroundStyle(Palette.fg)
                        }
                        .listRowBackground(Palette.surface)
                        NavigationLink(value: Route.trackers) {
                            Text("Devices").font(.plexSans(.body)).foregroundStyle(Palette.fg)
                        }
                        .listRowBackground(Palette.surface)
                        Button("Sign out", role: .destructive) { Task { await askBeforeSigningOut() } }
                            .disabled(checkingSignOut)
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.red)
                            .listRowBackground(Palette.surface)
                        if signOutCheckFailed {
                            Text(MadeWithStrava.checkFailed)
                                .font(.plexSans(.subheadline))
                                .foregroundStyle(Palette.red)
                                .accessibilityIdentifier("sign-out-check-failed")
                                .listRowBackground(Palette.surface)
                        }
                        if let noMailApp {
                            Text(noMailApp)
                                .font(.plexSans(.subheadline))
                                .foregroundStyle(Palette.fg)
                                .textSelection(.enabled)
                                .accessibilityIdentifier("no-mail-app")
                                .listRowBackground(Palette.surface)
                        }
                    } else {
                        if account.accountDeleted {
                            Text("Your account and everything in it are deleted.")
                                .font(.plexSans(.body))
                                .foregroundStyle(Palette.fg)
                                .accessibilityIdentifier("account-deleted")
                                .listRowBackground(Palette.surface)
                                .onAppear {
                                    AccessibilityNotification.Announcement(
                                        "Your account and everything in it are deleted."
                                    ).post()
                                }
                        }
                        Button(action: signIn) {
                            Text("Sign in").font(.plexSans(.body, weight: .semibold)).foregroundStyle(
                                Palette.primaryText)
                        }
                        .listRowBackground(Palette.surface)
                    }
                }
                Section("About") {
                    rows(Self.about)
                    HStack {
                        Text("Version").foregroundStyle(Palette.fg)
                        Spacer()
                        Text(Self.version).foregroundStyle(Palette.muted)
                            // iOS 17's audit cut it short (text clipped).
                            .fixedSize()
                    }
                    .font(.plexSans(.body))
                    .accessibilityElement(children: .combine)
                    .listRowBackground(Palette.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.bg)
            .navigationTitle("You")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .account: AccountView(account: account, signIn: signIn)
                case .trackers: TrackersView(account: account)
                }
            }
            .onChange(of: account.user?.id) { _, id in
                // Signed in again to delete: straight back
                // to the account.
                if id != nil && account.afterSignIn != nil { path = NavigationPath([Route.account]) }
            }
            .toolbarBackground(Palette.bg, for: .navigationBar)
            .sheet(item: $open) { page in
                SafariView(url: PaddlesnitchApp.baseURL.appending(path: page.path))
                    .ignoresSafeArea()
            }
            .confirmationDialog("Sign out of paddlesnitch?", isPresented: $confirmingSignOut, titleVisibility: .visible)
            {
                Button("Sign out", role: .destructive) { Task { await account.signOut() } }
                    .accessibilityIdentifier("confirm-sign-out")
            }
            // It can't sign back in until we move it to an email (lead).
            .alert("Sign out of paddlesnitch?", isPresented: $warningSignOut) {
                Button("Email us") {
                    openURL(SignInHelp.emailUs) { accepted in noMailApp = accepted ? nil : MadeWithStrava.noMailApp() }
                }
                .accessibilityIdentifier("sign-out-email-us")
                Button("Sign out anyway", role: .destructive) { Task { await account.signOut() } }
                    .accessibilityIdentifier("confirm-sign-out")
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(MadeWithStrava.signOutWarning)
            }
            // Whether this account was made with Strava, ready for signing out.
            .task(id: account.user?.id) {
                signOutCheckFailed = false
                noMailApp = nil
                await account.askMadeWithStrava()
            }
        }
    }

    /// Made with Strava: the warning; not: the plain confirm; unknown: say
    /// so and don't sign out.
    private func askBeforeSigningOut() async {
        checkingSignOut = true
        defer { checkingSignOut = false }
        switch await account.askMadeWithStrava() {
        case true?:
            signOutCheckFailed = false
            warningSignOut = true
        case false?:
            signOutCheckFailed = false
            confirmingSignOut = true
        case nil:
            signOutCheckFailed = true
            AccessibilityNotification.Announcement(MadeWithStrava.checkFailed).post()
        }
    }

    private func rows(_ pages: [WebPage]) -> some View {
        ForEach(pages) { page in
            Button {
                open = page
            } label: {
                HStack {
                    Text(page.title).font(.plexSans(.body)).foregroundStyle(Palette.fg)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(Palette.muted)
                        .accessibilityHidden(true)
                }
            }
            .listRowBackground(Palette.surface)
            .accessibilityHint("Opens paddlesnitch.com")
        }
    }

    static var shortVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}

/// The website inside the app, in Safari's own view.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredBarTintColor = UIColor(Palette.bg)
        controller.preferredControlTintColor = UIColor(Palette.primaryText)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
