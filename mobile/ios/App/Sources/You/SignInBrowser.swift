import Account
import AuthenticationServices
import SwiftUI

/// Strava's and Google's pages in the system's sign-in browser, which shares
/// Safari's cookies: someone signed in to Strava or Google there needn't sign
/// in again. Hands back the app address it ended on; closing it is a
/// CancellationError. The sample server's `answer` stands in for them.
@MainActor enum SignInBrowser {
    static func open(
        _ page: URL, with session: WebAuthenticationSession, sample answer: (URL) -> URL
    ) async throws -> URL {
        if PaddlesnitchApp.usesSampleServer { return answer(page) }
        do {
            return try await session.authenticate(
                using: page, callbackURLScheme: StravaSignIn.callbackScheme, preferredBrowserSession: .shared)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw CancellationError()
        }
    }
}
