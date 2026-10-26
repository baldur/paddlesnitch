import Foundation
import Observation
import PaddleAPI

/// Strava for a signed-in account, as the website's account page
/// (mobile/contract/README.md, "Strava, signed in"): connect through
/// Strava's own page, auto-import new paddles, disconnect. The words for
/// each result are the contract's `stravaConnectResults`.
@MainActor @Observable
public final class StravaConnection {
    public private(set) var status: StravaStatus?
    public private(set) var loadFailure: String?
    public private(set) var busy: Busy?
    /// What the last connect, change or disconnect came to.
    public private(set) var flash: Flash?
    /// The last refusal can be tried again (not `linked_elsewhere`).
    public private(set) var canTryAgain = false
    /// Connecting needs a sign-in from the last 10 minutes: sign in again.
    public private(set) var needsRecentSignIn = false

    public enum Busy: Equatable, Sendable {
        case connecting, autoImport, disconnecting
    }

    public enum Flash: Equatable, Sendable {
        case done(String)
        case failed(String)
    }

    private let account: AccountModel

    public init(account: AccountModel) {
        self.account = account
    }

    public func load() async {
        do {
            status = try await account.client.send(Endpoints.getStravaStatus, NoInput())
            loadFailure = nil
        } catch {
            loadFailure = ProfileForm.failure("Couldn't check Strava.", error)
        }
    }

    /// Asks the server for Strava's page, shows it in `browser` (the system
    /// sign-in browser, which hands back where it ended), then finishes with
    /// the verifier only this phone has. Closing the page says nothing.
    public func connect(browser: (URL) async throws -> URL) async {
        busy = .connecting
        flash = nil
        needsRecentSignIn = false
        defer { busy = nil }
        let verifier = Pkce.verifier()
        let page: URL
        do {
            let start = StravaConnectStart(challenge: Pkce.challenge(verifier))
            let link = try await account.client.send(Endpoints.stravaAppConnect, start)
            guard let url = URL(string: link.url) else { return fail("exchange_failed") }
            page = url
        } catch PaddleAPIError.rejected(_, 403, _) {
            needsRecentSignIn = true
            return
        } catch PaddleAPIError.rejected(_, 503, _) {
            return fail("not_configured", final: true)
        } catch {
            return failed(ProfileForm.failure("Couldn't connect Strava.", error))
        }
        let callback: URL
        do {
            callback = try await browser(page)
        } catch {
            return  // Closed Strava's page.
        }
        await finish(callback, verifier: verifier)
    }

    private func finish(_ callback: URL, verifier: String) async {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            fail(items.first { $0.name == "strava" }?.value ?? "exchange_failed")
            // A result is a cue to ask, never proof.
            await load()
            return
        }
        do {
            status = try await account.client.send(
                Endpoints.stravaAppConnectFinish, StravaConnectFinish(code: code, verifier: verifier))
            flash = .done(Self.words("connected"))
            canTryAgain = false
        } catch PaddleAPIError.rejected(_, 409, _) {
            fail("linked_elsewhere")
        } catch PaddleAPIError.rejected(_, 403, _) {
            needsRecentSignIn = true
        } catch PaddleAPIError.rejected(_, 400, _) {
            fail("exchange_failed")
        } catch {
            failed(ProfileForm.failure("Couldn't connect Strava.", error))
        }
    }

    public func setAutoImport(_ enabled: Bool) async {
        busy = .autoImport
        flash = nil
        defer { busy = nil }
        do {
            let answer = try await account.client.send(
                Endpoints.stravaAutoImport, StravaAutoImportSet(enabled: enabled))
            status?.autoImport = answer.autoImport
        } catch {
            failed(ProfileForm.failure("Couldn't change auto-import.", error))
        }
    }

    public func disconnect() async {
        busy = .disconnecting
        flash = nil
        defer { busy = nil }
        do {
            _ = try await account.client.send(Endpoints.stravaDisconnect, NoInput())
            status = StravaStatus(connected: false)
        } catch {
            failed(ProfileForm.failure("Couldn't disconnect Strava.", error))
        }
    }

    /// The contract's words for a result key; an unknown key reads as a
    /// plain failure.
    static func words(_ key: String) -> String {
        Constants.stravaConnectResults[key] ?? Constants.stravaConnectResults["exchange_failed"]
            ?? "Couldn’t connect Strava. Please try again."
    }

    private func fail(_ key: String, final: Bool = false) {
        flash = .failed(Self.words(key))
        canTryAgain = !final && key != "linked_elsewhere"
    }

    private func failed(_ message: String) {
        flash = .failed(message)
        canTryAgain = true
    }
}
