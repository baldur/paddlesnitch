import DesignSystem
import SafariServices
import SwiftUI

/// The account tab. Account pages open the website for now (mobile-apps.md:
/// account, privacy and terms stay web pages); signed-in link-outs come with C4.
struct YouView: View {
    struct WebPage: Identifiable {
        let title: String
        let path: String
        var id: String { path }
    }

    static let site = URL(string: "https://paddlesnitch.com") ?? URL(filePath: "/")

    static let account = [
        WebPage(title: "Your profile", path: "/profile/me"),
        WebPage(title: "Account settings", path: "/profile/me/settings"),
    ]
    static let about = [
        WebPage(title: "Privacy policy", path: "/privacy"),
        WebPage(title: "Terms of service", path: "/att/tos"),
    ]

    @State private var open: WebPage?

    var body: some View {
        NavigationStack {
            List {
                Section("Account") { rows(Self.account) }
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
            .toolbarBackground(Palette.bg, for: .navigationBar)
            .sheet(item: $open) { page in
                SafariView(url: Self.site.appending(path: page.path))
                    .ignoresSafeArea()
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
