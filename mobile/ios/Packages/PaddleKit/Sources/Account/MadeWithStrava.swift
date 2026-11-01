import Foundation
import PaddleAPI

/// An account made with Strava, which has gone from paddlesnitch: its
/// sign-in email is a placeholder (`Contact.placeholderEmail`), so it can't
/// sign in again until we move it to an email. Lead's decisions, 2026-11-01.
public enum MadeWithStrava {
    /// Asked before signing out.
    public static let signOutWarning =
        "You made this account with Strava, so you can’t sign back in until we move it to your email."

    /// Deleting it: an email to us, with the Support ID the Account screen
    /// shows, so we know which account.
    public static func deleteEmail(supportID: String) -> URL {
        var parts = URLComponents()
        parts.scheme = "mailto"
        parts.path = "privacy@paddlesnitch.com"
        parts.queryItems = [
            URLQueryItem(name: "subject", value: "Delete my account"),
            URLQueryItem(name: "body", value: "Support ID: \(supportID)"),
        ]
        return parts.url ?? URL(filePath: "/")
    }
}

extension AccountModel {
    /// The signed-in account was made with Strava, as far as the server has
    /// said. False while unknown, or if asking failed.
    public var madeWithStrava: Bool {
        guard let id = user?.id else { return false }
        return madeWithStravaUserId == id
    }

    /// Asks the server (`GET /api/account/contact`). A failed ask keeps what
    /// was known.
    public func checkMadeWithStrava() async {
        guard let contact = try? await client.send(Endpoints.getAccountContact, NoInput()) else { return }
        noteMadeWithStrava(contact.placeholderEmail == true)
    }

    func noteMadeWithStrava(_ made: Bool) {
        madeWithStravaUserId = made ? user?.id : nil
    }
}
