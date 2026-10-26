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
                return (422, Data(#"{"error":"The Terms of Service have changed. Update the app to sign up."}"#.utf8))
            }
            lock.withLock { _waitingForCode[signup.email] = signup.password }
            return (202, Data(#"{"needsCode":true,"email":"\#(signup.email)"}"#.utf8))
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
            _signInIsRecent = true
        }
        return (201, try signIn("auth.login"))
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
