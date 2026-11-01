import Foundation
import Observation
import PaddleAPI

/// Your details and public profile, as the website's /account: public or
/// private, the profile handle, and a contact email for an account whose
/// sign-in email is a Strava placeholder. The website's words throughout.
@MainActor @Observable
public final class ProfileForm {
    public private(set) var loaded = false
    public private(set) var loadFailure: String?
    public private(set) var isPublic: Bool?
    /// A failed public/private change, shown under its own button.
    public private(set) var visibilityMessage: String?
    public private(set) var handle: String?
    public var handleInput = ""
    public private(set) var handleMessage: String?
    public private(set) var handleFailed = false
    /// The sign-in email is a Strava placeholder: ask for a real one.
    public private(set) var needsContactEmail = false
    public private(set) var contactSaved: String?
    public var contactInput = ""
    public private(set) var contactMessage: String?
    public private(set) var contactFailed = false
    public private(set) var busy: Busy?

    public enum Busy: Hashable, Sendable {
        case visibility, handle, contact
    }

    private let account: AccountModel

    public init(account: AccountModel) {
        self.account = account
    }

    public var publicButton: String {
        if busy == .visibility { return "Saving…" }
        return isPublic == true ? "Make profile private" : "Make profile public"
    }

    public var profileLink: String { isPublic == true ? "View my profile" : "Preview my profile" }

    /// The handle help, with the saved handle in its example link, as the
    /// website's.
    public var handleHelp: String {
        "A short link like /profile/\(handle ?? "your-handle"). Lowercase letters, numbers and hyphens, 3–30 characters."
    }

    /// The public page: /profile/<handle>, or the account id without one.
    public var profilePath: String? {
        guard let id = account.user?.id else { return nil }
        return "/profile/\(handle ?? id)"
    }

    public var handleButton: String {
        if busy == .handle { return "Saving…" }
        return handle == nil ? "Save" : "Change"
    }

    public var canSaveHandle: Bool {
        let input = handleInput.trimmingCharacters(in: .whitespacesAndNewlines)
        return busy == nil && !input.isEmpty && input != handle
    }

    public var contactButton: String {
        if busy == .contact { return "Saving…" }
        return contactSaved == nil ? "Save" : "Update"
    }

    public func load() async {
        do {
            let profile = try await account.client.send(Endpoints.getAccountProfile, NoInput())
            let contact = try await account.client.send(Endpoints.getAccountContact, NoInput())
            show(profile)
            needsContactEmail = contact.placeholderEmail == true
            account.noteMadeWithStrava(needsContactEmail)
            contactSaved = contact.contact?.email
            contactInput = contactSaved ?? ""
            loadFailure = nil
            loaded = true
        } catch {
            loadFailure = Self.failure("Couldn't load your profile.", error)
        }
    }

    public func togglePublic() async {
        guard let isPublic else { return }
        busy = .visibility
        visibilityMessage = nil
        defer { busy = nil }
        do {
            show(try await account.client.send(Endpoints.patchAccountProfile, ProfileVisibility(public: !isPublic)))
        } catch {
            visibilityMessage = Self.failure("Couldn't update your profile.", error)
        }
    }

    public func saveHandle() async {
        guard canSaveHandle else { return }
        busy = .handle
        handleMessage = nil
        defer { busy = nil }
        do {
            let claim = HandleClaim(handle: handleInput.trimmingCharacters(in: .whitespacesAndNewlines))
            show(try await account.client.send(Endpoints.putAccountHandle, claim))
            say("Saved.", failed: false)
        } catch {
            say(Self.failure("Couldn't save your handle.", error), failed: true)
        }
    }

    public func removeHandle() async {
        busy = .handle
        handleMessage = nil
        defer { busy = nil }
        do {
            show(try await account.client.send(Endpoints.deleteAccountHandle, NoInput()))
            say("Handle released.", failed: false)
        } catch {
            say(Self.failure("Couldn't remove your handle.", error), failed: true)
        }
    }

    public func saveContact() async {
        let email = contactInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty else { return }
        busy = .contact
        contactMessage = nil
        defer { busy = nil }
        do {
            let saved = try await account.client.send(Endpoints.postAccountContact, ContactEmail(email: email))
            contactSaved = saved.contact?.email
            contactInput = contactSaved ?? email
            contactMessage = "Saved."
            contactFailed = false
        } catch {
            contactMessage = Self.failure("Couldn't save the email.", error)
            contactFailed = true
        }
    }

    public func removeContact() async {
        busy = .contact
        contactMessage = nil
        defer { busy = nil }
        do {
            _ = try await account.client.send(Endpoints.deleteAccountContact, NoInput())
            contactSaved = nil
            contactInput = ""
            contactMessage = "Removed."
            contactFailed = false
        } catch {
            contactMessage = Self.failure("Couldn't remove the email.", error)
            contactFailed = true
        }
    }

    private func show(_ profile: ProfileSettings) {
        isPublic = profile.public
        handle = profile.handle
        handleInput = profile.handle ?? ""
    }

    private func say(_ message: String, failed: Bool) {
        handleMessage = message
        handleFailed = failed
    }

    /// The server's words when it gave some, else "Couldn't …" + what to do.
    static func failure(_ what: String, _ error: any Error) -> String {
        switch error {
        case PaddleAPIError.rejected(let message, _, _): message
        case PaddleAPIError.signedOut: "\(what) Please sign in again."
        case is URLError: "\(what) Check your connection and try again."
        default: "\(what) Please try again."
        }
    }
}
