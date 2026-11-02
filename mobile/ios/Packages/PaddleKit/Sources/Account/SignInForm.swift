import Foundation
import Observation
import PaddleAPI

/// The sign-in sheet: sign in, or create an account, then the emailed code
/// that proves the address (#702). Same fields, checks and words as the
/// Android app and the website's /signin.
@MainActor @Observable
public final class SignInForm {
    public enum Mode: Hashable, Sendable {
        case signIn, createAccount
    }

    public enum Step: Hashable, Sendable {
        case form
        /// "Confirm your email": the code, after Create account or after a
        /// sign-in to an account whose code was never entered.
        case code(Mode)
    }

    public var mode: Mode = .signIn {
        didSet {
            if mode != oldValue {
                error = nil
                notice = nil
                status = nil
            }
        }
    }
    public var email = ""
    public var displayName = ""
    public var password = ""
    public var agreedToTerms = false
    /// Digits only, six at most; editing it puts the last status away.
    public var code = "" {
        didSet {
            let digits = String(code.filter(\.isNumber).prefix(6))
            if digits != code { code = digits }
            if code != oldValue { status = nil }
        }
    }
    public private(set) var step: Step = .form
    public private(set) var busy = false
    /// Sending a new code: its own flag, so only that button says "Sending…".
    public private(set) var resending = false
    public private(set) var error: String?
    /// Not an error: "Your new password is set. Please sign in."
    public private(set) var notice: String?
    /// Not an error, on the code step: "We've sent a new code…"
    public private(set) var status: String?
    /// When another code may be asked for: the website's 30 seconds.
    public private(set) var nextCodeAt: Date?
    private let now: @Sendable () -> Date

    public static let passwordRule = "At least 8 characters, with an uppercase letter, a lowercase letter and a number."
    public static let displayNameHelp = "Shown on leaderboards. You can change it later."

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    /// The screen asks again every second (TimelineView).
    public var canSendNewCode: Bool { now() >= (nextCodeAt ?? .distantPast) }

    public var title: String {
        switch (step, mode) {
        case (.code, _): "Confirm your email"
        case (.form, .signIn): "Sign in"
        case (.form, .createAccount): "Create account"
        }
    }

    public var codeExplainer: String {
        "We’ve emailed a 6-digit code to \(email) to check the address is yours. "
            + "It can take a minute; look in spam if it doesn’t arrive."
    }

    public var newCodeTitle: String { resending ? "Sending…" : "Send a new code" }

    /// Back from forgot password with the new one set but not signed in.
    public func passwordWasReset(email: String) {
        mode = .signIn
        self.email = email
        password = ""
        error = nil
        notice = "Your new password is set. Please sign in."
    }

    public var buttonTitle: String {
        if case .code = step { return busy ? "Confirming…" : "Confirm email" }
        return switch (mode, busy) {
        case (.signIn, false): "Sign in"
        case (.signIn, true): "Signing in…"
        case (.createAccount, false): "Create account"
        case (.createAccount, true): "Creating account…"
        }
    }

    /// Sends the form, or on the code step the code. True once signed in;
    /// otherwise `error` says why, or the code step opens.
    @discardableResult
    public func submit(to account: AccountModel) async -> Bool {
        if case .code(let origin) = step { return await confirm(to: account, origin: origin) }
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
            self.email = email
            if creating {
                try await account.createAccount(email: email, displayName: name, password: password)
                askForCode(origin: .createAccount, status: nil)
                return false
            }
            try await account.signIn(email: email, password: password)
            password = ""
            return true
        } catch PaddleAPIError.codeNeeded(let message) {
            askForCode(origin: .signIn, status: message)
        } catch {
            self.error = Self.message(for: error)
        }
        return false
    }

    private func confirm(to account: AccountModel, origin: Mode) async -> Bool {
        guard code.count == 6 else {
            error = "Enter the 6-digit code from the email."
            return false
        }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await account.confirmEmail(
                email: email, code: code, password: password, agreedToTerms: origin == .createAccount)
            password = ""
            return true
        } catch PaddleAPIError.rejected(let message, 500, _) {
            // Confirmed, but the sign-in after it failed: sign in from the
            // form (a new code would now be refused, 409).
            changeEmail()
            mode = .signIn
            self.error = message
            return false
        } catch {
            status = nil
            self.error = Self.message(for: error, fallback: "Couldn’t confirm your email. Please try again.")
            return false
        }
    }

    /// Repeats the call that sent the first code: Create account again, or
    /// the sign-in. True if that signed you in (the code was entered
    /// elsewhere meanwhile).
    @discardableResult
    public func sendNewCode(to account: AccountModel) async -> Bool {
        guard case .code(let origin) = step, canSendNewCode, !busy, !resending else { return false }
        resending = true
        error = nil
        status = nil
        defer { resending = false }
        do {
            if origin == .createAccount {
                try await account.createAccount(
                    email: email, displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password)
            } else {
                try await account.signIn(email: email, password: password)
                password = ""
                return true
            }
        } catch PaddleAPIError.codeNeeded {
        } catch {
            self.error = Self.message(for: error, fallback: "Couldn’t send a new code. Please try again.")
            return false
        }
        code = ""
        status = "We’ve sent a new code. You can ask for another in 30 seconds."
        startPause()
        return false
    }

    /// Back to the form the code step came from, to fix the email.
    public func changeEmail() {
        if case .code(let origin) = step { mode = origin }
        step = .form
        code = ""
        status = nil
        error = nil
    }

    private func askForCode(origin: Mode, status: String?) {
        step = .code(origin)
        code = ""
        self.status = status
        startPause()
    }

    private func startPause() {
        nextCodeAt = now().addingTimeInterval(30)
    }

    /// Signs in with Google. True once signed in; closing the sign-in page
    /// (`CancellationError`) leaves no error.
    @discardableResult
    public func signInWithGoogle(to account: AccountModel, browser: (URL) async throws -> URL) async -> Bool {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await account.signInWithGoogle(browser: browser)
            return true
        } catch is CancellationError {
        } catch {
            self.error = Self.message(for: error)
        }
        return false
    }

    static func message(for error: any Error, fallback: String = "Couldn't sign in. Please try again.") -> String {
        switch error {
        case PaddleAPIError.rejected(let message, _, _): message
        case PaddleAPIError.codeNeeded(let message): message
        case PaddleAPIError.accountDeleted(let message): message
        case let google as GoogleSignInError: google.message
        case is TokenStoreError: "Signed in, but this iPhone wouldn't keep you signed in. Try again."
        case is URLError: "Couldn't reach paddlesnitch. Check your connection and try again."
        default: fallback
        }
    }
}
