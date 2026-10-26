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
        XCTAssertTrue(element("sample-notice").waitForNonExistence(timeout: 15), "signed in")
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    func testWithStravaOffSignInOffersGoogleAndHelpNotStrava() {
        relaunch(["-StravaOff"])
        openSignIn()
        XCTAssertTrue(scrollToElement(app.buttons["google-sign-in"]).exists)
        XCTAssertTrue(text(containing: "Or use your Google account").exists)
        XCTAssertFalse(app.buttons["strava-sign-in"].exists, "no Strava sign-in")
        XCTAssertTrue(text(containing: "Signed up with Strava? Strava sign-in is off for now.").exists)
        XCTAssertTrue(scrollToElement(app.buttons["report-issue"]).exists)
    }

    func testWithStravaOffAConnectedAccountShowsStravaPaused() {
        relaunch(["-StravaOff", "-StravaConnected"])
        signInAndWait()
        openAccount()
        let row = scrollTo("strava-connected")
        XCTAssertTrue(row.waitForExistence(timeout: 10))
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
        XCTAssertFalse(element("strava-connect").waitForExistence(timeout: 3), "no Connect")
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
        XCTAssertTrue(scrollToElement(app.buttons["report-issue"]).waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["strava-sign-in"].exists)
    }

    /// Unknown isn't off: email only, and no word about Strava being off.
    func testWhenAskingFailsSignInIsEmailOnly() {
        relaunch(["-OptionsFail"])
        openSignIn()
        XCTAssertTrue(scrollToElement(app.buttons["sign-in-submit"]).exists)
        XCTAssertFalse(app.buttons["google-sign-in"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["strava-sign-in"].exists)
        XCTAssertFalse(app.buttons["report-issue"].exists, "doesn't say Strava is off")
    }

    /// An email account can still sign in again with Strava off.
    func testWithStravaOffAnEmailAccountSignsInAgainToDelete() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StravaOff", "-StaleSignIn"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").waitForExistence(timeout: 10))
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
        XCTAssertTrue(scrollTo("strava-connected").waitForExistence(timeout: 10))
        XCTAssertFalse(scrollToElement(app.buttons["Disconnect"]).exists, "its only way in")
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Report an issue and we’ll delete your account for you.").exists)
        XCTAssertTrue(app.buttons["Report an issue"].exists)
        XCTAssertFalse(app.buttons["Sign in again"].exists)
    }

    func testTheSignInSheetWithStravaOffPassesTheAccessibilityAudit() throws {
        relaunch(["-StravaOff"])
        openSignIn()
        XCTAssertTrue(app.buttons["google-sign-in"].waitForExistence(timeout: 10))
        try audit()
    }

    private func openSignIn() {
        let notice = app.buttons["sample-notice-action"]
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        notice.tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
    }

    private func relaunch(_ extra: [String]) {
        app.terminate()
        app.launchArguments = ["-SampleServer", "-ResetAccount"] + extra
        app.launch()
    }
}
