import Foundation
import PaddleAPI

/// The emailed codes: sign-up's (#702) and forgot password's.
extension SampleServer {
    /// Sign-up (#702): a code instead of a sign-in, then the code.
    func signup(path: String, body: Data) throws -> (Int, Data) {
        switch path {
        case "/att/api/auth/signup":
            let signup = try JSONDecoder().decode(Signup.self, from: body)
            guard signup.acceptedTosVersion == Constants.tosVersion else {
                return (422, Data(#"{"error":"Please accept the Terms of Service to create an account."}"#.utf8))
            }
            if lock.withLock({ _tooManyCodes }) { return (429, try fixture("auth.too-many-codes")) }
            lock.withLock {
                _waitingForCode[signup.email] = signup.password
                _unconfirmed.insert(signup.email)
            }
            var sent = try JSONDecoder.paddlesnitch.decode(CodeSent.self, from: try fixture("auth.signup"))
            sent.email = signup.email
            return (202, try JSONEncoder.paddlesnitch.encode(sent))
        case "/att/api/auth/signup/confirm":
            return try confirmSignup(body)
        default:
            return (404, Data(#"{"error":"Not found"}"#.utf8))
        }
    }

    /// The sign-up code (#702): `signupCode` works for an account waiting
    /// for one, with the password it was started with.
    func confirmSignup(_ body: Data) throws -> (Int, Data) {
        let confirm = try JSONDecoder().decode(SignupConfirm.self, from: body)
        let waiting = lock.withLock { _waitingForCode[confirm.email] }
        guard confirm.code == Self.signupCode else {
            return (400, Data(#"{"error":"\#(Self.wrongSignupCodeMessage)"}"#.utf8))
        }
        guard waiting == confirm.password else {
            let words = "That doesn’t match the account waiting for this code. Please create your account again."
            return (400, Data(#"{"error":"\#(words)"}"#.utf8))
        }
        lock.withLock {
            _waitingForCode[confirm.email] = nil
            _unconfirmed.remove(confirm.email)
            _signInIsRecent = true
        }
        if lock.withLock({ _confirmSignInFails }) {
            return (500, Data(#"{"error":"Your email is confirmed. Please sign in."}"#.utf8))
        }
        return (
            201, try signIn(confirm.email == Self.unconfirmedOldTermsEmail ? "auth.login.needs-terms" : "auth.login")
        )
    }

    /// Forgot password: `resetCode` works, any other code is wrong.
    func passwordReset(path: String, body: Data) throws -> (Int, Data) {
        switch path {
        case "/att/api/auth/password-reset/request":
            _ = try JSONDecoder().decode(ResetRequest.self, from: body)
            return (200, Data(#"{"ok":true}"#.utf8))
        case "/att/api/auth/password-reset/confirm":
            let confirm = try JSONDecoder().decode(ResetConfirm.self, from: body)
            guard confirm.code == Self.resetCode else {
                return (400, Data(#"{"error":"\#(Self.wrongResetCodeMessage)"}"#.utf8))
            }
            if confirm.email == Self.resetWithoutSignInEmail {
                return (200, Data(#"{"ok":true,"signedIn":false}"#.utf8))
            }
            return (200, try fixture("auth.password-reset-confirm"))
        default:
            return (404, Data(#"{"error":"Not found"}"#.utf8))
        }
    }
}
