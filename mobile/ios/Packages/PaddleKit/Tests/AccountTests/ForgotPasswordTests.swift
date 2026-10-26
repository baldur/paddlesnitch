import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// Forgot password (mobile/contract/README.md, "Signing in"): an email code,
/// then a new password, which signs you in. The website's steps and words.
@MainActor @Suite struct ForgotPasswordTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()

    func account() -> AccountModel {
        let suite = "forgot-\(UUID().uuidString)"
        return AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens,
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
    }

    @Test func askingForACodeSendsTheEmailAnEmptyTrapAndHowLongTheFormWasOpen() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1000))
        let form = ForgotPasswordForm(now: { clock.now })
        form.email = "  pat@example.com "
        clock.now += 4.2
        #expect(await form.requestCode(to: account()))
        let sent = try #require(server.requests.last)
        #expect(sent.url?.path == "/att/api/auth/password-reset/request")
        let body = try JSONDecoder().decode(ResetRequest.self, from: sent.httpBody ?? Data())
        #expect(body.email == "pat@example.com")
        #expect(body.website == "")
        #expect(body.elapsedMs == 4200)
        #expect(form.step == .code)
    }

    @Test func withNoEmailNothingIsSent() async {
        let form = ForgotPasswordForm()
        #expect(!(await form.requestCode(to: account())))
        #expect(form.error == "Enter your email.")
        #expect(server.requests.isEmpty)
    }

    @Test func theRightCodeAndANewPasswordSignYouIn() async throws {
        let account = account()
        let form = ForgotPasswordForm()
        form.email = "pat@example.com"
        _ = await form.requestCode(to: account)
        form.code = SampleServer.resetCode
        form.password = "NewPassword1"
        #expect(await form.resetPassword(to: account) == .signedIn)
        #expect(account.user?.email == "pat@example.com", "who, from me")
        #expect(tokens.load() != nil)
        let sent = try #require(server.requests.first { $0.url?.path == "/att/api/auth/password-reset/confirm" })
        let body = try JSONDecoder().decode(ResetConfirm.self, from: sent.httpBody ?? Data())
        #expect(body == ResetConfirm(code: SampleServer.resetCode, email: "pat@example.com", password: "NewPassword1"))
    }

    @Test func aWrongCodeSaysSoInTheServersWordsAndKeepsTheForm() async {
        let account = account()
        let form = ForgotPasswordForm()
        form.email = "pat@example.com"
        _ = await form.requestCode(to: account)
        form.code = "000000"
        form.password = "NewPassword1"
        #expect(await form.resetPassword(to: account) == nil)
        #expect(form.error == SampleServer.wrongResetCodeMessage)
        #expect(form.step == .code)
        #expect(account.user == nil)
    }

    @Test func setButNotSignedInSendsYouBackToSignIn() async {
        let account = account()
        let form = ForgotPasswordForm()
        form.email = SampleServer.resetWithoutSignInEmail
        _ = await form.requestCode(to: account)
        form.code = SampleServer.resetCode
        form.password = "NewPassword1"
        #expect(await form.resetPassword(to: account) == .signInAgain)
        #expect(account.user == nil)
    }

    @Test func aMissingCodeOrPasswordIsCaughtHere() async {
        let form = ForgotPasswordForm()
        form.email = "pat@example.com"
        form.code = "12345"
        form.password = "NewPassword1"
        #expect(await form.resetPassword(to: account()) == nil)
        #expect(form.error == "Enter the 6-digit code from the email.")
        form.code = "123456"
        form.password = ""
        #expect(await form.resetPassword(to: account()) == nil)
        #expect(form.error == "Choose a new password.")
        #expect(server.requests.isEmpty)
    }

    @Test func buttonsSayWhatHappens() async {
        let form = ForgotPasswordForm()
        #expect(form.buttonTitle == "Send code")
        form.email = "pat@example.com"
        _ = await form.requestCode(to: account())
        #expect(form.buttonTitle == "Reset password")
    }
}

/// A clock the test moves on by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var _now: Date
    init(_ now: Date) { _now = now }
    var now: Date {
        get { lock.withLock { _now } }
        set { lock.withLock { _now = newValue } }
    }
}

@MainActor @Suite struct PasswordWasResetTests {
    @Test func backOnSignInWithTheEmailAndANoteNotAnError() {
        let form = SignInForm()
        form.mode = .createAccount
        form.password = "old"
        form.passwordWasReset(email: "kim@example.com")
        #expect(form.mode == .signIn)
        #expect(form.email == "kim@example.com")
        #expect(form.password.isEmpty)
        #expect(form.notice == "Your new password is set. Please sign in.")
        #expect(form.error == nil)
        form.mode = .createAccount
        #expect(form.notice == nil, "a note about signing in goes with the sign-in tab")
    }
}
