import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// Strava for a signed-in account (mobile/contract/README.md, "Strava,
/// signed in"): connect through Strava's own page, then auto-import and
/// disconnect. The words for each result are the contract's
/// `stravaConnectResults`, as the website's.
@MainActor @Suite struct StravaConnectionTests {
    let server = SampleServer(fixtures: fixtures)

    func connection() async throws -> StravaConnection {
        let suite = "strava-\(UUID().uuidString)"
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: MemoryTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        return StravaConnection(account: account)
    }

    @Test func notConnectedToStart() async throws {
        let strava = try await connection()
        await strava.load()
        #expect(strava.status?.connected == false)
    }

    @Test func connectingOpensStravaThenFinishesWithTheVerifier() async throws {
        let strava = try await connection()
        await strava.load()
        var opened: URL?
        await strava.connect { url in
            opened = url
            return SampleServer.stravaConnectBrowser(url)
        }
        #expect(opened?.host() == "www.strava.com", "Strava's own consent page")
        #expect(strava.status?.connected == true)
        #expect(strava.status?.athlete?.name == "Pat Paddler")
        #expect(strava.flash == .done(Constants.stravaConnectResults["connected"] ?? ""))
        let finish = try #require(server.requests.last { $0.url?.path == "/att/api/strava/app-connect/finish" })
        #expect(finish.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
    }

    @Test func aRefusalSaysSoAndCanBeTriedAgain() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { _ in
            URL(string: "com.paddlesnitch.app:/account/strava?strava=denied") ?? URL(filePath: "/")
        }
        #expect(strava.flash == .failed(Constants.stravaConnectResults["denied"] ?? "?"))
        #expect(strava.canTryAgain)
        #expect(strava.status?.connected == false)
    }

    @Test func aStravaAccountOnAnotherAccountCantBeTriedAgain() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { _ in
            URL(string: "com.paddlesnitch.app:/account/strava?strava=linked_elsewhere") ?? URL(filePath: "/")
        }
        #expect(strava.flash == .failed(Constants.stravaConnectResults["linked_elsewhere"] ?? "?"))
        #expect(!strava.canTryAgain)
    }

    @Test func aSpentCodeSaysTryAgain() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { _ in
            URL(string: "com.paddlesnitch.app:/account/strava?code=sample.other") ?? URL(filePath: "/")
        }
        #expect(strava.flash == .failed(Constants.stravaConnectResults["exchange_failed"] ?? "?"))
        #expect(strava.canTryAgain)
        #expect(strava.status?.connected == false)
    }

    @Test func closingStravasPageSaysNothing() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { _ in throw CancellationError() }
        #expect(strava.flash == nil)
    }

    @Test func anOldSignInAsksForANewOneBeforeOpeningStrava() async throws {
        let strava = try await connection()
        await strava.load()
        server.signInIsRecent = false
        var opened = false
        await strava.connect { url in
            opened = true
            return url
        }
        #expect(!opened)
        #expect(strava.needsRecentSignIn)
        #expect(strava.flash == nil)
    }

    @Test func notConfiguredSaysSoWithoutOpeningABrowser() async throws {
        let strava = try await connection()
        await strava.load()
        server.stravaNotConfigured = true
        var opened = false
        await strava.connect { url in
            opened = true
            return url
        }
        #expect(!opened)
        #expect(strava.flash == .failed(Constants.stravaConnectResults["not_configured"] ?? "?"))
        #expect(!strava.canTryAgain, "nothing to try again until it's set up")
    }

    @Test func autoImportAndDisconnect() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { SampleServer.stravaConnectBrowser($0) }
        #expect(strava.status?.autoImport == true, "on by default")
        await strava.setAutoImport(false)
        #expect(strava.status?.autoImport == false)
        await strava.disconnect()
        #expect(strava.status?.connected == false)
    }

    @Test func aStravaAccountOnAnotherAccountRefusedAtTheFinish() async throws {
        let strava = try await connection()
        await strava.load()
        server.stravaLinkedElsewhere = true
        await strava.connect { SampleServer.stravaConnectBrowser($0) }
        #expect(strava.flash == .failed(Constants.stravaConnectResults["linked_elsewhere"] ?? "?"))
        #expect(!strava.canTryAgain)
    }

    @Test func aSignInGoneStaleOnStravasPageAsksForANewOne() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { page in
            server.signInIsRecent = false
            return SampleServer.stravaConnectBrowser(page)
        }
        #expect(strava.needsRecentSignIn)
        #expect(strava.flash == nil)
    }

    @Test func aResultIsACueToAskNotProof() async throws {
        let strava = try await connection()
        await strava.load()
        server.stravaConnected = true  // Connected on the website meanwhile.
        await strava.connect { _ in
            URL(string: "com.paddlesnitch.app:/account/strava?strava=denied") ?? URL(filePath: "/")
        }
        #expect(strava.status?.connected == true)
    }

    @Test func anUnknownResultReadsAsAPlainFailure() async throws {
        let strava = try await connection()
        await strava.load()
        await strava.connect { _ in
            URL(string: "com.paddlesnitch.app:/account/strava?strava=bogus") ?? URL(filePath: "/")
        }
        #expect(strava.flash == .failed(Constants.stravaConnectResults["exchange_failed"] ?? "?"))
        #expect(strava.canTryAgain)
    }

    @Test func aFailedCheckSaysSoAndCanBeTriedAgain() async throws {
        let strava = try await connection()
        server.failsStrava = true
        await strava.load()
        #expect(strava.status == nil)
        #expect(strava.loadFailure?.hasPrefix("Couldn’t check Strava.") == true)
        #expect(strava.busy == nil)
        server.failsStrava = false
        await strava.load()
        #expect(strava.status?.connected == false)
        #expect(strava.loadFailure == nil)
    }

    @Test func failedChangesKeepWhatTheServerHas() async throws {
        let strava = try await connection()
        await strava.connect { SampleServer.stravaConnectBrowser($0) }
        server.failsStrava = true
        await strava.setAutoImport(false)
        #expect(strava.status?.autoImport == true)
        #expect(strava.flash == .failed("Couldn’t change auto-import. Please try again."))
        await strava.disconnect()
        #expect(strava.status?.connected == true)
        #expect(strava.flash == .failed("Couldn’t disconnect Strava. Please try again."))
        #expect(strava.busy == nil)
    }

    @Test func autoImportAndDisconnectReachTheServer() async throws {
        let strava = try await connection()
        await strava.connect { SampleServer.stravaConnectBrowser($0) }
        await strava.setAutoImport(false)
        let set = try #require(server.requests.last { $0.url?.path == "/att/api/strava/auto-import" })
        #expect(try JSONDecoder().decode(StravaAutoImportSet.self, from: set.httpBody ?? Data()).enabled == false)
        await strava.disconnect()
        await strava.load()
        #expect(strava.status?.connected == false)
    }
}
