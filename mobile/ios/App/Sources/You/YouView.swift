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

    struct WebPage: Identifiable {
        let title: String
        let path: String
        var id: String { path }
    }

    static let account = [WebPage(title: "Your profile", path: "/profile/me")]
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
                        rows(Self.account)
                        Button("Sign out", role: .destructive) { confirmingSignOut = true }
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.red)
                            .listRowBackground(Palette.surface)
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
                // Signed in again to delete: straight back to the account.
                if id != nil && account.deleteAfterSignIn { path = NavigationPath([Route.account]) }
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
