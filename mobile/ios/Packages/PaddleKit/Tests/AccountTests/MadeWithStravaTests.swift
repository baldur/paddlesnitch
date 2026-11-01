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

    @Test func unknownUntilAskedThenTheServersAnswer() async throws {
        let account = try await signedIn()
        #expect(account.madeWithStrava == nil, "unknown isn't no")
        server.placeholderEmail = true
        #expect(await account.askMadeWithStrava() == true)
        #expect(account.madeWithStrava == true)
    }

    @Test func aRealEmailIsNo() async throws {
        let account = try await signedIn()
        #expect(await account.askMadeWithStrava() == false)
        #expect(account.madeWithStrava == false)
    }

    /// A failed ask is nil, never "no": Delete and Sign out wait for an
    /// answer rather than lock the account out.
    @Test func aFailedAskIsUnknown() async throws {
        let account = try await signedIn()
        server.failsContact = true
        #expect(await account.askMadeWithStrava() == nil)
        #expect(account.madeWithStrava == nil)
    }

    @Test func aKnownAnswerIsKeptWithoutAsking() async throws {
        let account = try await signedIn()
        server.placeholderEmail = true
        await account.askMadeWithStrava()
        server.failsContact = true
        #expect(await account.askMadeWithStrava() == true)
    }

    @Test func loadingTheProfileAnswersToo() async throws {
        let account = try await signedIn()
        server.placeholderEmail = true
        await ProfileForm(account: account).load()
        #expect(account.madeWithStrava == true)
    }

    @Test func theAnswerIsForThatAccountOnly() async throws {
        let account = try await signedIn()
        server.placeholderEmail = true
        await account.askMadeWithStrava()
        await account.signOut()
        #expect(account.madeWithStrava == nil, "signed out")
        account.madeWithStravaAnswer = ("someone-else", true)
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        #expect(account.madeWithStrava == nil, "another account's answer")
    }

    /// An answer that comes back after another account signed in is
    /// dropped, not kept for the new one (security-privacy).
    @Test func aLateAnswerForAnotherAccountIsDropped() async throws {
        let account = try await signedIn()
        account.noteMadeWithStrava(false, for: "the-account-that-asked")
        #expect(account.madeWithStrava == nil)
        account.noteMadeWithStrava(true, for: account.user?.id)
        #expect(account.madeWithStrava == true)
    }

    @Test func theWordsAreLeadsDecision() {
        #expect(
            MadeWithStrava.signOutWarning
                == "You made this account with Strava, so you can’t sign back in until we move it to your email.")
    }

    @Test func theDeleteWordsAreAndroidsToo() {
        #expect(
            MadeWithStrava.deleteWords
                == "An account made with Strava can’t sign in again here. Email us and we’ll delete it.")
        #expect(MadeWithStrava.checkFailed == "Couldn’t check your account. Please try again.")
    }

    /// No mail app: the address as text, and the Support ID for deleting.
    @Test func withoutAMailAppTheAddressShows() {
        #expect(MadeWithStrava.noMailApp() == "Email us at privacy@paddlesnitch.com.")
        #expect(
            MadeWithStrava.noMailApp(supportID: "user-1") == "Email us at privacy@paddlesnitch.com.\nSupport ID: user-1"
        )
    }

    @Test func deletingIsAnEmailWithTheSupportID() {
        #expect(
            MadeWithStrava.deleteEmail(supportID: "user-1").absoluteString
                == "mailto:privacy@paddlesnitch.com?subject=Delete%20my%20account&body=Support%20ID:%20user-1")
    }
}
