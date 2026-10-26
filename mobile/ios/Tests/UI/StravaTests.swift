import XCTest

/// Strava on the Account screen, against the sample server: Strava's page
/// says yes at once, as Pat Paddler.
final class StravaTests: AppTestCase {
    func testConnectingStravaThenAutoImportAndDisconnect() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["strava-connect"]).tap()
        XCTAssertEqual(scrollTo("strava-flash").label, "Strava connected.")
        XCTAssertTrue(element("strava-connected").label.contains("Pat Paddler"))

        let autoImport = scrollToElement(app.switches["strava-auto-import"])
        XCTAssertEqual(autoImport.value as? String, "1", "on by default")
        // The switch itself, at the row's end: tapping the label does nothing.
        autoImport.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        let off = expectation(for: NSPredicate(format: "value == '0'"), evaluatedWith: autoImport)
        wait(for: [off], timeout: 10)

        scrollToElement(app.buttons["Disconnect"]).tap()
        let confirm = app.buttons["Disconnect Strava"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "asks first")
        confirm.tap()
        XCTAssertTrue(scrollToElement(app.buttons["strava-connect"]).waitForExistence(timeout: 10))
    }

    /// Connecting needs a sign-in from the last 10 minutes: sign in again,
    /// then straight back to connecting.
    func testAnOldSignInSignsInAgainThenConnects() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StaleSignIn"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["strava-connect"]).tap()
        XCTAssertTrue(scrollTo("strava-reauth").waitForExistence(timeout: 10))
        scrollToElement(app.buttons["Sign in again"]).tap()

        let email = app.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        XCTAssertEqual(email.value as? String, "pat@example.com", "the email they were signed in with")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText("Password123")
        app.buttons["sign-in-submit"].tap()

        XCTAssertEqual(scrollTo("strava-flash").label, "Strava connected.", "straight back to connecting")
    }

    func testStravaConnectedPassesTheAccessibilityAudit() throws {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["strava-connect"]).tap()
        XCTAssertTrue(scrollTo("strava-connected").waitForExistence(timeout: 10))
        try audit()
    }
}
