import XCTest

/// Sign in with Google, and the screens without Strava, which has gone
/// (mobile/contract/README.md, Signing in → "Google"), against the sample
/// server.
final class GoogleSignInTests: AppTestCase {
    func testSigningInWithGoogleShowsYourPaddles() {
        openSignIn()
        let google = scrollToElement(app.buttons["google-sign-in"])
        XCTAssertEqual(google.label, "Sign in with Google")
        google.tap()
        XCTAssertTrue(signedIn(), "signed in")
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    /// Google, then always the line for an account made with Strava, with
    /// Email us; never a Strava button.
    func testSignInOffersGoogleAndTheLineForAStravaAccount() {
        openSignIn()
        signInHasNoStrava()
    }

    /// An older server that still says Strava is on changes nothing.
    func testAServerThatSaysStravaIsOnChangesNothing() {
        relaunch(["-OptionsSayStrava"])
        openSignIn()
        signInHasNoStrava()
    }

    private func signInHasNoStrava() {
        XCTAssertTrue(scrollToElement(app.buttons["google-sign-in"]).exists)
        XCTAssertTrue(text(containing: "Or use your Google account").exists)
        XCTAssertFalse(app.buttons["strava-sign-in"].exists, "no Strava sign-in")
        XCTAssertTrue(
            scrollTo("made-with-strava").label
                == "Made your account with Strava? Email us and we’ll move it to your email.")
        XCTAssertTrue(scrollToElement(app.buttons["email-us"]).exists)
    }

    func testAccountHasNoStrava() {
        signInAndWait()
        openAccount()
        XCTAssertTrue(scrollToElement(app.buttons["Download my data"]).exists)
        XCTAssertFalse(element("strava-connect").appears(timeout: 3), "no Connect")
        XCTAssertFalse(element("strava-connected").exists)
    }

    /// "Couldn't load the other ways to sign in." with Try again, and the
    /// line for a Strava account still there.
    func testWhenAskingFailsSignInSaysSoAndCanTryAgain() {
        relaunch(["-OptionsFail"])
        openSignIn()
        XCTAssertTrue(scrollTo("ways-in-failed").appears(timeout: 10))
        XCTAssertFalse(app.buttons["google-sign-in"].exists)
        XCTAssertTrue(scrollToElement(app.buttons["ways-in-try-again"]).exists)
        XCTAssertTrue(scrollToElement(app.buttons["email-us"]).exists, "a Strava account can still ask")
    }

    func testAnEmailAccountSignsInAgainToDelete() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StaleSignIn"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").appears(timeout: 10))
        XCTAssertTrue(app.buttons["Sign in again"].exists)
        XCTAssertFalse(app.buttons["delete-email-us"].exists)
        XCTAssertFalse(text(containing: "An account made with Strava").exists)
    }

    /// Made with Strava (its sign-in email is a placeholder): no way back in
    /// to sign in again with, so deleting offers Email us instead, with the
    /// Support ID (lead, 2026-11-01).
    func testAnAccountMadeWithStravaIsOfferedHelpToDelete() {
        signInAndWait()
        // Signed in a while ago (stale), kept across the relaunch.
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StaleSignIn", "-PlaceholderEmail"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        let words = element("delete-needs-sign-in")
        XCTAssertTrue(words.appears(timeout: 10))
        XCTAssertEqual(
            words.label, "An account made with Strava can’t sign in again here. Email us and we’ll delete it.")
        XCTAssertTrue(app.buttons["delete-email-us"].exists)
        XCTAssertEqual(app.buttons["delete-email-us"].label, "Email us")
        XCTAssertFalse(app.buttons["Sign in again"].exists)
        XCTAssertFalse(app.buttons["Report an issue"].exists)
    }

    func testTheSignInSheetPassesTheAccessibilityAudit() throws {
        openSignIn()
        XCTAssertTrue(app.buttons["google-sign-in"].appears(timeout: 10))
        try audit()
    }

    private func openSignIn() {
        let notice = app.buttons["sample-notice-action"]
        XCTAssertTrue(notice.appears(timeout: 10))
        notice.tap()
        XCTAssertTrue(app.textFields["Email"].appears(timeout: 10))
    }

    private func relaunch(_ extra: [String]) {
        app.terminate()
        app.launchArguments = ["-SampleServer", "-ResetAccount"] + extra
        app.launch()
    }
}
