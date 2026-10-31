import Account
import DesignSystem
import Paddles
import SwiftUI

/// The bottom tab bar. The web's phone layout has Paddles, Trials, Plan and
/// You (docs/features/design-system.md); Trials arrives in P4.
struct RootView: View {
    let account: AccountModel
    let samples: SamplePaddles
    @State private var signingIn = false
    @State private var termsOpen = false
    @State private var selectedTab = "paddles"
    @State private var adding: AddPaddleModel

    init(account: AccountModel, samples: SamplePaddles) {
        self.account = account
        self.samples = samples
        _adding = State(
            initialValue: AddPaddleModel { [account] name, data in
                let client = await account.client
                return try await client.upload(fileName: name, data: data)
            })
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            // The same list view throughout; it reloads when `sourceID` changes
            // (samples, or this person's). Rebuilding its navigation stack
            // under the closing sign-in sheet crashed UIKit on iOS 17.
            PaddleListView(
                source: source, sourceID: account.user?.id ?? "samples", isSample: account.user == nil,
                needsTerms: account.user?.needsTerms == true, signIn: { signingIn = true },
                openTerms: { termsOpen = true }, adding: adding, options: account.options,
                openFile: { url in Task { await open(url) } }
            )
            .tabItem { Label("Paddles", systemImage: "water.waves") }
            .tag("paddles")
            YouView(account: account, signIn: { signingIn = true })
                .tabItem { Label("You", systemImage: "person.crop.circle") }
                .tag("you")
        }
        // A GPS file opened in the app from Files, Mail or a share sheet.
        .onOpenURL { url in Task { await open(url) } }
        .onChange(of: account.user?.id) { _, id in
            if id != nil { Task { await adding.signedIn() } }
        }
        .task { await openLaunchFile() }
        .onReceive(NotificationCenter.default.publisher(for: .signOutForTest)) { _ in
            if PaddlesnitchApp.usesSampleServer { Task { await account.signOut() } }
        }
        // Google and Strava, for the screens that offer them.
        .task { await account.loadOptions() }
        .tint(Palette.primaryText)
        .preferredColorScheme(.dark)
        .sheet(
            isPresented: $signingIn,
            onDismiss: {
                account.signInSheetUp = false
                // Closed without signing in again: don't jump back later.
                if account.user == nil && account.afterSignIn != nil { account.resumed() }
            },
            content: { SignInView(account: account) }
        )
        // Up from opening until it has finished closing, not just asked to.
        // onDismiss says when; in case it never comes (a sheet closed while
        // still opening, on iOS 17), it's down a second after closing.
        .onChange(of: signingIn) { _, opening in
            if opening {
                account.signInSheetUp = true
            } else {
                Task {
                    try? await Task.sleep(for: .seconds(1))
                    if !signingIn { account.signInSheetUp = false }
                }
            }
        }
        .sheet(isPresented: $termsOpen) {
            NavigationStack {
                List {
                    Section {
                        TermsView(account: account, accepted: { termsOpen = false })
                    } header: {
                        Text("Terms of Service").font(.plexSans(.subheadline, weight: .medium))
                            .foregroundStyle(Palette.muted).textCase(nil)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Palette.bg)
                .navigationTitle("Terms of Service")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { termsOpen = false } } }
            }
            .preferredColorScheme(.dark)
        }
    }

    /// Adds the paddle in a GPS file, or keeps it until sign-in.
    private func open(_ url: URL) async {
        selectedTab = "paddles"
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            adding.couldNotRead()
            return
        }
        await adding.add(fileName: url.lastPathComponent, data: data, signedIn: account.user != nil)
    }

    /// UI tests: `-OpenFile <name>` with the sample server plays a file
    /// opened from another app (see AddPaddleTests).
    private func openLaunchFile() async {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-SampleServer"), let flag = arguments.firstIndex(of: "-OpenFile"),
            flag + 1 < arguments.count
        else { return }
        let url = FileManager.default.temporaryDirectory.appending(path: arguments[flag + 1])
        try? Data("<gpx/>".utf8).write(to: url)
        await open(url)
    }

    private var source: any PaddlesSource {
        account.user == nil ? samples : ServerPaddles(client: account.client)
    }
}
