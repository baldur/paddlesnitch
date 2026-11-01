import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// An account made with Strava, which has gone: known from
/// `Contact.placeholderEmail`, it gets a question before signing out and
/// Email us to delete (lead, 2026-11-01).
@MainActor @Suite struct MadeWithStravaTests {
    let server = SampleServer(fixtures: fixtures)

    func signedIn() async throws -> AccountModel {
        let suite = "strava-made-\(UUID().uuidString)"
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: MemoryTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        return account
    }

    @Test func theServersPlaceholderEmailSaysSo() async throws {
        let account = try await signedIn()
        #expect(!account.madeWithStrava, "unknown until asked")
        server.placeholderEmail = true
        await account.checkMadeWithStrava()
        #expect(account.madeWithStrava)
        server.placeholderEmail = false
        await account.checkMadeWithStrava()
        #expect(!account.madeWithStrava)
    }

    @Test func loadingTheProfileSaysSoToo() async throws {
        let account = try await signedIn()
        server.placeholderEmail = true
        await ProfileForm(account: account).load()
        #expect(account.madeWithStrava)
    }

    @Test func itIsForThatAccountOnly() async throws {
        let account = try await signedIn()
        server.placeholderEmail = true
        await account.checkMadeWithStrava()
        await account.signOut()
        #expect(!account.madeWithStrava, "signed out")
        account.madeWithStravaUserId = "someone-else"
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        #expect(!account.madeWithStrava, "another account")
    }

    @Test func theWordsAreLeadsDecision() {
        #expect(
            MadeWithStrava.signOutWarning
                == "You made this account with Strava, so you can’t sign back in until we move it to your email.")
    }

    @Test func deletingIsAnEmailWithTheSupportID() {
        #expect(
            MadeWithStrava.deleteEmail(supportID: "user-1").absoluteString
                == "mailto:privacy@paddlesnitch.com?subject=Delete%20my%20account&body=Support%20ID:%20user-1")
    }
}
