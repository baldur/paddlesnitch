import Foundation
import Observation
import PaddleAPI

/// Forgot password, as the website's /signin/forgot and /signin/reset: your
/// email, then the 6-digit code from it and a new password, which signs you
/// in (mobile/contract/README.md, "Signing in").
@MainActor @Observable
public final class ForgotPasswordForm {
    public enum Step: Hashable, Sendable {
        case email, code
    }

    public enum Outcome: Hashable, Sendable {
        case signedIn
        /// The password is set, but the server didn't sign you in.
        case signInAgain
    }

    public private(set) var step: Step = .email
    public var email = ""
    public var code = ""
    public var password = ""
    public private(set) var busy = false
    public private(set) var error: String?

    /// The website's honeypot and timing, which tell a person from a bot.
    private let openedAt: Date
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
        openedAt = now()
    }

    public var buttonTitle: String {
        switch (step, busy) {
        case (.email, false): "Send code"
        case (.email, true): "Sending…"
        case (.code, false): "Reset password"
        case (.code, true): "Resetting…"
        }
    }

    /// Asks for a code. The answer is the same whether or not the account
    /// exists, so the next step never says which.
    @discardableResult
    public func requestCode(to account: AccountModel) async -> Bool {
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty else {
            error = "Enter your email."
            return false
        }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let elapsed = (now().timeIntervalSince(openedAt) * 1000).rounded()
            try await account.requestPasswordReset(ResetRequest(elapsedMs: elapsed, email: email, website: ""))
            self.email = email
            step = .code
            return true
        } catch {
            self.error = Self.message(for: error, fallback: "Couldn't send the reset code. Please try again.")
            return false
        }
    }

    /// Sets the new password. Nil when it didn't work; `error` says why.
    public func resetPassword(to account: AccountModel) async -> Outcome? {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 6, code.allSatisfy(\.isNumber) else {
            error = "Enter the 6-digit code from the email."
            return nil
        }
        guard !password.isEmpty else {
            error = "Choose a new password."
            return nil
        }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let signedIn = try await account.resetPassword(ResetConfirm(code: code, email: email, password: password))
            password = ""
            return signedIn ? .signedIn : .signInAgain
        } catch {
            self.error = Self.message(for: error, fallback: "Couldn't reset your password. Please try again.")
            return nil
        }
    }

    static func message(for error: any Error, fallback: String) -> String {
        switch error {
        case PaddleAPIError.rejected(let message, _, _): message
        case is URLError: "Couldn't reach paddlesnitch. Check your connection and try again."
        default: fallback
        }
    }
}
