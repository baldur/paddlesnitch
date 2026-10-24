import Foundation
import Observation
import PaddleAPI

/// The sign-in sheet: sign in, or create an account. Same fields, checks and
/// words as the Android app and the website's /signin.
@MainActor @Observable
public final class SignInForm {
    public enum Mode: Hashable, Sendable {
        case signIn, createAccount
    }

    public var mode: Mode = .signIn {
        didSet { if mode != oldValue { error = nil } }
    }
    public var email = ""
    public var displayName = ""
    public var password = ""
    public var agreedToTerms = false
    public private(set) var busy = false
    public private(set) var error: String?

    public static let passwordRule = "At least 8 characters, with an uppercase letter, a lowercase letter and a number."
    public static let displayNameHelp = "Shown on leaderboards. You can change it later."

    public init() {}

    public var buttonTitle: String {
        switch (mode, busy) {
        case (.signIn, false): "Sign in"
        case (.signIn, true): "Signing in…"
        case (.createAccount, false): "Create account"
        case (.createAccount, true): "Creating account…"
        }
    }

    /// Sends the form. True once signed in; otherwise `error` says why.
    @discardableResult
    public func submit(to account: AccountModel) async -> Bool {
        let creating = mode == .createAccount
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if creating && !agreedToTerms {
            error = "You must agree to the Terms of Service to create an account."
            return false
        }
        if email.isEmpty || password.isEmpty || (creating && name.isEmpty) {
            error = "Fill in every field."
            return false
        }
        busy = true
        error = nil
        defer { busy = false }
        do {
            if creating {
                try await account.createAccount(email: email, displayName: name, password: password)
            } else {
                try await account.signIn(email: email, password: password)
            }
            password = ""
            return true
        } catch PaddleAPIError.rejected(let message, _, _) {
            error = message
        } catch is TokenStoreError {
            error = "Signed in, but this iPhone wouldn't keep you signed in. Try again."
        } catch is URLError {
            error = "Can't reach paddlesnitch. Check your connection and try again."
        } catch {
            self.error = "Something went wrong. Try again in a moment."
        }
        return false
    }
}
