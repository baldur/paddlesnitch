import XCTest

/// Sign in with Google, and the screens with Strava switched off
/// (mobile/contract/README.md, Signing in → "Google", "When strava is
/// false"), against the sample server.
final class GoogleSignInTests: AppTestCase {
    func testSigningInWithGoogleShowsYourPaddles() {
        openSignIn()
        let google = scrollToElement(app.buttons["google-sign-in"])
        XCTAssertEqual(google.label, "Sign in with Google")
        google.tap()
        XCTAssertTrue(signedIn(), "signed in")
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    func testWithStravaOffSignInOffersGoogleAndHelpNotStrava() {
        relaunch(["-StravaOff"])
        openSignIn()
        XCTAssertTrue(scrollToElement(app.buttons["google-sign-in"]).exists)
        XCTAssertTrue(text(containing: "Or use your Google account").exists)
        XCTAssertFalse(app.buttons["strava-sign-in"].exists, "no Strava sign-in")
        XCTAssertTrue(text(containing: "Signed up with Strava? Strava sign-in is off for now. Email us").exists)
        XCTAssertTrue(scrollToElement(app.buttons["email-us"]).exists)
    }

    func testWithStravaOffAConnectedAccountShowsStravaPaused() {
        relaunch(["-StravaOff", "-StravaConnected"])
        signInAndWait()
        openAccount()
        let row = scrollTo("strava-connected")
        XCTAssertTrue(row.appears(timeout: 10))
        XCTAssertTrue(row.label.contains("Paused"))
        XCTAssertTrue(text(containing: "Strava isn’t available right now.").exists)
        XCTAssertTrue(scrollToElement(app.buttons["Disconnect"]).exists)
        XCTAssertFalse(app.switches["strava-auto-import"].exists, "no auto-import")
    }

    func testWithStravaOffAnAccountNotConnectedHasNoStrava() {
        relaunch(["-StravaOff"])
        signInAndWait()
        openAccount()
        noStravaSection()
    }

    /// Strava between Public profile and Your data: on screen with Your
    /// data, and given time to come.
    private func noStravaSection() {
        XCTAssertTrue(scrollToElement(app.buttons["Download my data"]).exists)
        XCTAssertFalse(element("strava-connect").appears(timeout: 3), "no Connect")
        XCTAssertFalse(element("strava-connected").exists)
    }

    /// Account asks again: Strava went off after the app's first ask.
    func testAccountAsksWhichWaysInAreOn() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StravaOffLater"]
        app.launch()
        openAccount()
        noStravaSection()
    }

    /// The sign-in sheet asks again: Strava went off after the app's first ask.
    func testSignInAsksWhichWaysInAreOn() {
        relaunch(["-StravaOffLater"])
        openSignIn()
        XCTAssertTrue(scrollToElement(app.buttons["email-us"]).appears(timeout: 10))
        XCTAssertFalse(app.buttons["strava-sign-in"].exists)
    }

    /// Unknown isn't off: the email form, "Couldn't load the other ways to
    /// sign in." with Try again, and no word about Strava being off.
    func testWhenAskingFailsSignInSaysSoAndCanTryAgain() {
        relaunch(["-OptionsFail"])
        openSignIn()
        XCTAssertTrue(scrollTo("ways-in-failed").appears(timeout: 10))
        XCTAssertFalse(app.buttons["google-sign-in"].exists)
        XCTAssertFalse(app.buttons["strava-sign-in"].exists)
        XCTAssertFalse(app.buttons["email-us"].exists, "doesn't say Strava is off")
        XCTAssertTrue(scrollToElement(app.buttons["ways-in-try-again"]).exists)
    }

    /// An email account can still sign in again with Strava off.
    func testWithStravaOffAnEmailAccountSignsInAgainToDelete() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StravaOff", "-StaleSignIn"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").appears(timeout: 10))
        XCTAssertTrue(app.buttons["Sign in again"].exists)
        XCTAssertFalse(app.buttons["Report an issue"].exists)
    }

    /// Made through Strava, with Strava off: no way back in to sign in again
    /// with, so deleting asks for help instead, and Strava can't be
    /// disconnected (it's the account's only way in).
    func testWithStravaOffAStravaAccountIsOfferedHelpToDelete() {
        signInAndWait()
        // Signed in a while ago (stale), kept across the relaunch.
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StravaOff", "-StravaConnected", "-StaleSignIn", "-StravaAccount"]
        app.launch()
        openAccount()
        XCTAssertTrue(scrollTo("strava-connected").appears(timeout: 10))
        XCTAssertFalse(scrollToElement(app.buttons["Disconnect"]).exists, "its only way in")
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").appears(timeout: 10))
        XCTAssertTrue(text(containing: "leave out your name and email: reports are public.").exists)
        XCTAssertFalse(app.buttons["Sign in again"].exists)
        // Signed in through a one-time link, so it's filed as this account.
        app.buttons["Report an issue"].tap()
        XCTAssertFalse(element("delete-error").appears(timeout: 3), "the signed-in link came")
    }

    func testTheSignInSheetWithStravaOffPassesTheAccessibilityAudit() throws {
        relaunch(["-StravaOff"])
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
