import Foundation
import PaddleAPI

/// An account made with Strava, which has gone from paddlesnitch: its
/// sign-in email is a placeholder (`Contact.placeholderEmail`), so it can't
/// sign in again until we move it to an email. Lead's decisions, 2026-11-01.
public enum MadeWithStrava {
    /// Asked before signing out.
    public static let signOutWarning =
        "You made this account with Strava, so you can’t sign back in until we move it to your email."
    /// Beside Email us, when a fresh sign-in is needed to delete.
    public static let deleteWords =
        "An account made with Strava can’t sign in again here. Email us and we’ll delete it."
    /// Asking the server failed: Sign out and Delete wait for an answer, as
    /// guessing "no" would lock the account out.
    public static let checkFailed = "Couldn’t check your account. Please try again."

    public static let address = "privacy@paddlesnitch.com"

    /// Deleting it: an email to us, with the Support ID the Account screen
    /// shows, so we know which account.
    public static func deleteEmail(supportID: String) -> URL {
        var parts = URLComponents()
        parts.scheme = "mailto"
        parts.path = address
        parts.queryItems = [
            URLQueryItem(name: "subject", value: "Delete my account"),
            URLQueryItem(name: "body", value: "Support ID: \(supportID)"),
        ]
        return parts.url ?? URL(filePath: "/")
    }

    /// When no mail app opens: the address to write to, as text, and the
    /// Support ID when there's one to quote.
    public static func noMailApp(supportID: String? = nil) -> String {
        ["Email us at \(address).", supportID.map { "Support ID: \($0)" }].compactMap { $0 }.joined(separator: "\n")
    }
}

extension AccountModel {
    /// Whether the signed-in account was made with Strava: nil while
    /// unknown (not asked yet, or asking failed). Never read nil as no.
    public var madeWithStrava: Bool? {
        guard let id = user?.id, let answer = madeWithStravaAnswer, answer.userId == id else { return nil }
        return answer.made
    }

    /// The known answer for this account, or the server's
    /// (`GET /api/account/contact`); nil if that fails.
    @discardableResult
    public func askMadeWithStrava() async -> Bool? {
        if let known = madeWithStrava { return known }
        guard user != nil, let contact = try? await client.send(Endpoints.getAccountContact, NoInput()) else {
            return nil
        }
        noteMadeWithStrava(contact.placeholderEmail == true)
        return madeWithStrava
    }

    func noteMadeWithStrava(_ made: Bool) {
        madeWithStravaAnswer = user.map { ($0.id, made) }
    }
}
