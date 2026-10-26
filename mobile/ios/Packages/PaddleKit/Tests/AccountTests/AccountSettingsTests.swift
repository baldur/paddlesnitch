import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// The native Account screen's calls, against the sample server (the
/// contract's account fixtures): Terms, downloading your data, deleting the
/// account.
/// Serialized: the tests share the temp folder the export is written to.
@MainActor @Suite(.serialized) struct AccountSettingsTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()
    let profile: ProfileStore

    init() {
        let suite = "account-settings-\(UUID().uuidString)"
        profile = ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard })
    }

    func signedIn(_ email: String = "pat@example.com") async throws -> AccountModel {
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens, profile: profile)
        try await account.signIn(email: email, password: SampleServer.password)
        return account
    }

    // MARK: Terms

    @Test func anAccountUpToDateHasAcceptedTheTerms() async throws {
        let status = try await signedIn().termsStatus()
        #expect(status.accepted)
        #expect(status.currentVersion == Constants.tosVersion)
    }

    @Test func acceptingTheNewTermsSendsThisVersionAndClearsTheNotice() async throws {
        let account = try await signedIn(SampleServer.needsTermsEmail)
        #expect(account.user?.needsTerms == true)
        #expect(try await account.termsStatus().accepted == false)

        try await account.acceptTerms()

        let sent = try #require(server.requests.last { $0.url?.path == "/api/account/tos" && $0.httpMethod == "POST" })
        #expect(try JSONDecoder().decode(TosAccept.self, from: sent.httpBody ?? Data()).version == Constants.tosVersion)
        #expect(account.user?.needsTerms == false)
        #expect(profile.load()?.needsTerms == false, "remembered after a relaunch")
        #expect(try await account.termsStatus().accepted)
    }

    // MARK: Your data

    @Test func downloadingYourDataGetsTheWholeFileFromTheLink() async throws {
        let file = try await signedIn().downloadData()
        #expect(file.lastPathComponent.hasPrefix("paddlesnitch-data-"), "dated, to tell saved copies apart")
        #expect(file.pathExtension == "json")
        let object = try JSONSerialization.jsonObject(with: try Data(contentsOf: file)) as? [String: Any]
        #expect(object?["account"] != nil)
        // The link is fetched as it is: no token on a link that carries its own.
        let fetch = try #require(server.requests.last)
        #expect(fetch.url?.path == SampleServer.exportPath)
        #expect(fetch.value(forHTTPHeaderField: "Authorization") == nil)
    }

    /// The whole account in one file: it mustn't stay in the app once
    /// shared, after the account is deleted, or after signing out.
    @Test func theDownloadedFileIsRemovedOnceShared() async throws {
        let account = try await signedIn()
        let file = try await account.downloadData()
        account.removeDownloadedData()
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func theDownloadedFileIsRemovedWhenTheAccountIsDeleted() async throws {
        let account = try await signedIn()
        let file = try await account.downloadData()
        try await account.deleteAccount()
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func theDownloadedFileIsRemovedOnSigningOut() async throws {
        let account = try await signedIn()
        let file = try await account.downloadData()
        await account.signOut()
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test func aDeletedAccountSaysSoUntilTheNextSignIn() async throws {
        let account = try await signedIn()
        try await account.deleteAccount()
        #expect(account.accountDeleted)
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        #expect(!account.accountDeleted)
    }

    @Test func aLinkRelativeToTheSiteIsResolvedAgainstIt() throws {
        let base = try #require(URL(string: "http://localhost:3000"))
        #expect(
            AccountModel.resolve("/exports/u/a.json", against: base)?.absoluteString
                == "http://localhost:3000/exports/u/a.json")
        #expect(
            AccountModel.resolve("https://bucket.test/a.json?X=1", against: base)?.absoluteString
                == "https://bucket.test/a.json?X=1")
    }

    // MARK: Deleting the account

    @Test func deletingTheAccountRevokesTheRefreshTokenAndSignsOut() async throws {
        let account = try await signedIn()
        let refreshToken = try #require(tokens.load())

        try await account.deleteAccount()

        let sent = try #require(server.requests.last { $0.url?.path == "/api/account" })
        #expect(sent.httpMethod == "DELETE")
        #expect(
            try JSONDecoder().decode(DeleteAccount.self, from: sent.httpBody ?? Data()).refreshToken == refreshToken)
        #expect(account.user == nil)
        #expect(tokens.load() == nil)
        #expect(profile.load() == nil)
        #expect(server.revokedTokens.contains(refreshToken))
        #expect(!server.requests.contains { $0.url?.path == "/att/api/auth/logout" }, "already revoked")
    }

    @Test func aFailedDeleteKeepsYouSignedIn() async throws {
        let account = try await signedIn()
        server.failsAccountDelete = true
        await #expect(throws: PaddleAPIError.self) { try await account.deleteAccount() }
        #expect(account.user != nil)
        #expect(tokens.load() != nil)
    }

    // MARK: A recent sign-in before deleting (mobile/contract/README.md, Account)

    @Test func justSignedInIsRecent() async throws {
        #expect(try await signedIn().recentSignIn())
    }

    @Test func anOldSignInIsNotRecentAndDeletingIsRefusedForIt() async throws {
        let account = try await signedIn()
        server.signInIsRecent = false
        #expect(try await account.recentSignIn() == false)
        await #expect(throws: AccountModel.DeleteError.needsRecentSignIn) { try await account.deleteAccount() }
        #expect(account.user != nil, "never signed out without asking")
        #expect(tokens.load() != nil)
    }

    @Test func signingOutToDeleteRemembersToComeBackWithTheEmail() async throws {
        let account = try await signedIn()
        await account.signOutToSignInAgain(then: .delete)
        #expect(account.user == nil)
        #expect(account.afterSignIn == .delete)
        #expect(account.signInAgainEmail == "pat@example.com")
        account.resumed()
        #expect(account.afterSignIn == nil)
        #expect(account.signInAgainEmail == nil)
    }

    @Test func aStravaAccountSignsInAgainWithStravaNotAnEmail() async throws {
        let account = try await signedIn()
        await account.signOutToSignInAgain(then: .delete, withStrava: true)
        #expect(account.signInAgainWithStrava)
        #expect(account.signInAgainEmail == nil, "its sign-in email is a placeholder")
        account.resumed()
        #expect(!account.signInAgainWithStrava)
    }
}
