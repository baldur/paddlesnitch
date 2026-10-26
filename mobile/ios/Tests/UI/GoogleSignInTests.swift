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
        XCTAssertTrue(scrollToElement(app.buttons["Delete my account"]).exists)
        XCTAssertFalse(element("strava-connect").exists)
        XCTAssertFalse(element("strava-connected").exists)
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
        XCTAssertFalse(app.buttons["Disconnect"].exists, "its only way in")
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
