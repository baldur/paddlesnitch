import XCTest

/// Signing in, out and up, against the sample server.
final class SignInTests: AppTestCase {
    func testSigningInShowsYourPaddles() {
        signInAndWait()
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
        selectTab("You")
        XCTAssertTrue(element("signed-in-as").appears(timeout: 10))
        XCTAssertTrue(text(containing: "Pat").exists)
        XCTAssertTrue(app.buttons["Account"].exists)
    }

    func testSigningOutGoesBackToTheSamples() {
        signInAndWait()
        selectTab("You")
        app.buttons["Sign out"].firstMatch.tap()
        let confirm = app.buttons["confirm-sign-out"].firstMatch
        XCTAssertTrue(confirm.appears(timeout: 10), "asks before signing out")
        XCTAssertEqual(confirm.label, "Sign out")
        XCTAssertFalse(app.buttons["sign-out-email-us"].exists, "an account with a password")
        XCTAssertFalse(text(containing: "can’t sign back in").exists)
        confirm.tap()
        XCTAssertTrue(app.buttons["Sign in"].appears(timeout: 10))
        selectTab("Paddles")
        XCTAssertTrue(element("sample-notice").appears(timeout: 10))
    }

    /// Made with Strava, which has gone: signing out would lock it out, so
    /// it asks first, offering Email us (lead, 2026-11-01).
    func testAnAccountMadeWithStravaIsWarnedBeforeSigningOut() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-PlaceholderEmail"]
        app.launch()
        selectTab("You")
        app.buttons["Sign out"].firstMatch.tap()
        XCTAssertTrue(
            text(
                containing:
                    "You made this account with Strava, so you can’t sign back in until we move it to your email."
            )
            .appears(timeout: 10))
        XCTAssertTrue(app.buttons["sign-out-email-us"].exists)
        XCTAssertTrue(app.buttons["Cancel"].exists)
        let anyway = app.buttons["confirm-sign-out"].firstMatch
        XCTAssertEqual(anyway.label, "Sign out anyway")
        anyway.tap()
        XCTAssertTrue(app.buttons["Sign in"].appears(timeout: 10))
    }

    /// Unknown isn't "no": when the server can't say whether the account was
    /// made with Strava, Sign out says so and doesn't sign out.
    func testSigningOutWaitsWhenItCantCheckTheAccount() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-ContactFails"]
        app.launch()
        selectTab("You")
        app.buttons["Sign out"].firstMatch.tap()
        let failed = element("sign-out-check-failed")
        XCTAssertTrue(failed.appears(timeout: 10))
        XCTAssertEqual(failed.label, "Couldn’t check your account. Please try again.")
        XCTAssertFalse(app.buttons["confirm-sign-out"].exists, "no sign-out offered")
        XCTAssertTrue(element("signed-in-as").exists, "still signed in")
    }

    /// The line for an account made with Strava is on Sign in only.
    func testCreateAccountHasNoLineForAStravaAccount() {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(scrollTo("made-with-strava").exists, "on Sign in")
        scrollToElement(app.buttons["Create account"].firstMatch).tap()
        XCTAssertTrue(app.textFields["Display name"].appears(timeout: 10))
        XCTAssertFalse(element("made-with-strava").exists)
        XCTAssertFalse(app.buttons["email-us"].exists)
    }

    func testAnAccountWithChangedTermsIsToldSo() {
        signInAndWait(email: "sam@example.com")
        XCTAssertTrue(element("terms-notice").appears(timeout: 10))
        XCTAssertTrue(text(containing: "The Terms of Service have changed").exists)
    }

    func testCreatingAnAccountNeedsTheTermsTicked() {
        app.buttons["sample-notice-action"].tap()
        showCreateAccount()
        let name = app.textFields["Display name"]
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
        showCreateAccount()
        try audit()
    }

    func testYouSignedInPassesTheAccessibilityAudit() throws {
        signInAndWait()
        selectTab("You")
        XCTAssertTrue(element("signed-in-as").appears(timeout: 10))
        try audit()
    }
}
