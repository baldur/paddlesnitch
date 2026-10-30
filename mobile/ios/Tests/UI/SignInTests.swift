import XCTest

/// Signing in, out and up, against the sample server.
final class SignInTests: AppTestCase {
    func testSigningInShowsYourPaddles() {
        signInAndWait()
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    func testSigningInWithStravaShowsYourPaddles() {
        let notice = app.buttons["sample-notice-action"]
        XCTAssertTrue(notice.appears(timeout: 10))
        notice.tap()
        let strava = app.buttons["strava-sign-in"]
        XCTAssertTrue(strava.appears(timeout: 10))
        XCTAssertEqual(strava.label, "Connect with Strava")
        if !strava.isHittable { app.swipeUp() }
        strava.tap()
        XCTAssertTrue(signedIn(), "still showing the samples")
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    func testAWrongPasswordShowsTheServersWords() {
        signIn(password: "wrong")
        XCTAssertTrue(text(containing: "That email and password don’t match.").appears(timeout: 10))
        XCTAssertTrue(app.buttons["sign-in-submit"].exists, "still on the form")
    }

    func testYouStaySignedInAfterTheAppIsRelaunched() {
        signInAndWait()
        app.terminate()
        // Not -ResetAccount this time: the refresh token is in the Keychain.
        app.launchArguments = ["-SampleServer"]
        app.launch()
        tab("You").tap()
        XCTAssertTrue(element("signed-in-as").appears(timeout: 10))
        XCTAssertTrue(text(containing: "Pat").exists)
        XCTAssertTrue(app.buttons["Account"].exists)
    }

    func testSigningOutGoesBackToTheSamples() {
        signInAndWait()
        tab("You").tap()
        app.buttons["Sign out"].firstMatch.tap()
        let confirm = app.buttons["confirm-sign-out"].firstMatch
        XCTAssertTrue(confirm.appears(timeout: 10), "asks before signing out")
        confirm.tap()
        XCTAssertTrue(app.buttons["Sign in"].appears(timeout: 10))
        tab("Paddles").tap()
        XCTAssertTrue(element("sample-notice").appears(timeout: 10))
    }

    func testAnAccountWithChangedTermsIsToldSo() {
        signInAndWait(email: "sam@example.com")
        XCTAssertTrue(element("terms-notice").appears(timeout: 10))
        XCTAssertTrue(text(containing: "The Terms of Service have changed").exists)
    }

    func testCreatingAnAccountNeedsTheTermsTicked() {
        app.buttons["sample-notice-action"].tap()
        app.buttons["Create account"].firstMatch.tap()
        let name = app.textFields["Display name"]
        XCTAssertTrue(name.appears(timeout: 10))
        fill(email: "new@example.com", password: "Secret123")
        type("New", into: name)
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(text(containing: "You must agree to the Terms of Service").appears(timeout: 10))
        element("terms-checkbox").tap()
        app.buttons["sign-in-submit"].tap()
        // Since #702 the emailed code proves the address first.
        XCTAssertTrue(element("code-explainer").appears(timeout: 10))
        declineSavingPassword()
        typeWhenFocused("123456", into: app.textFields["code-field"])
        tapWhenClear(app.buttons["sign-in-submit"])
        XCTAssertTrue(signedIn(), "signed up and in")
    }

    func testTheSignInSheetPassesTheAccessibilityAudit() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].appears(timeout: 10))
        try audit()
        app.buttons["Create account"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Display name"].appears(timeout: 10))
        try audit()
    }

    func testYouSignedInPassesTheAccessibilityAudit() throws {
        signInAndWait()
        tab("You").tap()
        XCTAssertTrue(element("signed-in-as").appears(timeout: 10))
        try audit()
    }
}
