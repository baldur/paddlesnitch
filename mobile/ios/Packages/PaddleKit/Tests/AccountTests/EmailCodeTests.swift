import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// Email sign-up proves the address (#702, mobile/contract/README.md
/// "Signing in"): Create account emails a code, and the code signs you in.
/// A sign-in to an account whose code was never entered asks for it too.
@MainActor @Suite struct EmailCodeTests {
    let server = SampleServer(fixtures: fixtures)
    let tokens = MemoryTokenStore()

    func account() -> AccountModel {
        let suite = "code-\(UUID().uuidString)"
        return AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: tokens,
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
    }

    /// A clock the test moves on: the 30 seconds between codes.
    func form(_ clock: TestClock = TestClock(Date(timeIntervalSince1970: 1000))) -> SignInForm {
        SignInForm(now: { clock.now })
    }

    func createAccount(_ form: SignInForm, on account: AccountModel) async -> Bool {
        form.mode = .createAccount
        form.email = "new@example.com"
        form.displayName = "New"
        form.password = "Secret123"
        form.agreedToTerms = true
        return await form.submit(to: account)
    }

    @Test func createAccountAsksForTheEmailedCode() async {
        let account = account()
        let form = form()
        #expect(await createAccount(form, on: account) == false, "not signed in yet")
        #expect(form.step == .code(.createAccount))
        #expect(form.title == "Confirm your email")
        #expect(form.buttonTitle == "Confirm email")
        #expect(form.codeExplainer.contains("new@example.com"))
        #expect(form.status == nil)
        #expect(form.error == nil)
        #expect(account.user == nil)
    }

    @Test func theCodeSignsYouInAndAgreesToTheTermsJustTicked() async throws {
        let account = account()
        let form = form()
        _ = await createAccount(form, on: account)
        form.code = SampleServer.signupCode
        #expect(await form.submit(to: account))
        #expect(account.user != nil)
        let sent = try #require(server.requests.last { $0.url?.path == "/att/api/auth/signup/confirm" })
        let body = try JSONDecoder().decode(SignupConfirm.self, from: sent.httpBody ?? Data())
        #expect(
            body
                == SignupConfirm(
                    acceptedTosVersion: Constants.tosVersion, code: SampleServer.signupCode, email: "new@example.com",
                    password: "Secret123"))
    }

    @Test func aWrongCodeSaysSoInTheServersWords() async {
        let account = account()
        let form = form()
        _ = await createAccount(form, on: account)
        form.code = "000000"
        #expect(await form.submit(to: account) == false)
        #expect(form.error == SampleServer.wrongSignupCodeMessage)
        #expect(form.step == .code(.createAccount))
    }

    @Test func signingInBeforeTheCodeAsksForItAsAStatusNotAnError() async throws {
        let account = account()
        let form = form()
        form.email = SampleServer.unconfirmedEmail
        form.password = SampleServer.password
        #expect(await form.submit(to: account) == false)
        #expect(form.step == .code(.signIn))
        #expect(form.status == "Confirm your email first. We’ve sent you a new code.")
        #expect(form.error == nil)

        form.code = SampleServer.signupCode
        #expect(await form.submit(to: account))
        let sent = try #require(server.requests.last { $0.url?.path == "/att/api/auth/signup/confirm" })
        let body = try JSONDecoder().decode(SignupConfirm.self, from: sent.httpBody ?? Data())
        #expect(body.acceptedTosVersion == nil, "the Terms weren't ticked: follow needsTerms instead")
    }

    @Test func aNewCodeRepeatsTheFirstCallThenWaitsThirtySeconds() async {
        let account = account()
        let clock = TestClock(Date(timeIntervalSince1970: 1000))
        let form = form(clock)
        _ = await createAccount(form, on: account)
        #expect(!form.canSendNewCode, "30 s after the first code too")
        clock.now += 29
        #expect(!form.canSendNewCode)
        clock.now += 1
        #expect(form.canSendNewCode)

        let signups = server.requests.filter { $0.url?.path == "/att/api/auth/signup" }.count
        #expect(await form.sendNewCode(to: account) == false)
        #expect(server.requests.filter { $0.url?.path == "/att/api/auth/signup" }.count == signups + 1)
        #expect(form.status == "We’ve sent a new code. You can ask for another in 30 seconds.")
        #expect(!form.canSendNewCode)
        #expect(form.nextCodeAt == clock.now.addingTimeInterval(30))
    }

    @Test func aNewCodeFromSignInRepeatsTheSignIn() async {
        let account = account()
        let clock = TestClock(Date(timeIntervalSince1970: 1000))
        let form = form(clock)
        form.email = SampleServer.unconfirmedEmail
        form.password = SampleServer.password
        _ = await form.submit(to: account)
        clock.now += 30
        let logins = server.requests.filter { $0.url?.path == "/att/api/auth/login" }.count
        _ = await form.sendNewCode(to: account)
        #expect(server.requests.filter { $0.url?.path == "/att/api/auth/login" }.count == logins + 1)
        #expect(form.status == "We’ve sent a new code. You can ask for another in 30 seconds.")
    }

    @Test func changeEmailGoesBackToTheFormItCameFrom() async {
        let form = form()
        _ = await createAccount(form, on: account())
        form.code = "12"
        form.changeEmail()
        #expect(form.step == .form)
        #expect(form.mode == .createAccount)
        #expect(form.code.isEmpty)
        #expect(form.status == nil)
        #expect(form.title == "Create account")
    }

    @Test func aCodeThatIsntSixDigitsIsCaughtHere() async {
        let account = account()
        let form = form()
        _ = await createAccount(form, on: account)
        let sent = server.requests.count
        form.code = "12345"
        #expect(await form.submit(to: account) == false)
        #expect(form.error == "Enter the 6-digit code from the email.")
        #expect(server.requests.count == sent)
    }

    @Test func theCodeKeepsOnlySixDigitsAndEditingClearsTheStatus() async {
        let form = form()
        form.email = SampleServer.unconfirmedEmail
        form.password = SampleServer.password
        _ = await form.submit(to: account())
        #expect(form.status != nil)
        form.code = "12 34-5678"
        #expect(form.code == "123456")
        #expect(form.status == nil)
    }

    /// Confirmed, but the sign-in after it failed (500): back to Sign in with
    /// the server's words, since a new code would now be refused (409).
    @Test func confirmedButNotSignedInGoesBackToSignIn() async {
        let account = account()
        let form = form()
        _ = await createAccount(form, on: account)
        server.confirmSignInFails = true
        form.code = SampleServer.signupCode
        #expect(await form.submit(to: account) == false)
        #expect(form.step == .form)
        #expect(form.mode == .signIn)
        #expect(form.error == "Your email is confirmed. Please sign in.")
        #expect(form.email == "new@example.com")
    }

    @Test func confirmingAndSendingAreBusySeparately() async {
        let form = form()
        _ = await createAccount(form, on: account())
        #expect(!form.busy && !form.resending)
        #expect(form.buttonTitle == "Confirm email")
        #expect(form.newCodeTitle == "Send a new code")
    }

    /// The code was entered elsewhere meanwhile: asking again signs you in.
    @Test func aNewCodeAfterConfirmingElsewhereSignsYouIn() async {
        let account = account()
        let clock = TestClock(Date(timeIntervalSince1970: 1000))
        let form = form(clock)
        form.email = SampleServer.unconfirmedEmail
        form.password = SampleServer.password
        _ = await form.submit(to: account)
        server.confirmElsewhere(SampleServer.unconfirmedEmail)
        clock.now += 30
        #expect(await form.sendNewCode(to: account))
        #expect(account.user != nil)
    }

    @Test func tooManyCodesIsAnErrorAndDoesntRestartThePause() async {
        let account = account()
        let clock = TestClock(Date(timeIntervalSince1970: 1000))
        let form = form(clock)
        _ = await createAccount(form, on: account)
        clock.now += 30
        let allowedAt = form.nextCodeAt
        server.tooManyCodes = true
        #expect(await form.sendNewCode(to: account) == false)
        #expect(form.error == "We’ve sent this email too many codes. Please wait an hour and try again.")
        #expect(form.status == nil)
        #expect(form.nextCodeAt == allowedAt, "the pause isn't restarted")
    }

    /// From a sign-in the Terms weren't ticked: the answer says whether
    /// they're out of date.
    @Test func confirmingFromSignInFollowsNeedsTerms() async {
        let account = account()
        let form = form()
        form.email = SampleServer.unconfirmedOldTermsEmail
        form.password = SampleServer.password
        _ = await form.submit(to: account)
        form.code = SampleServer.signupCode
        #expect(await form.submit(to: account))
        #expect(account.user?.needsTerms == true)
    }
}
