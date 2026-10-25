import XCTest

/// Adding a paddle from a GPS file. A file opened in the app from Files, Mail
/// or a share sheet is played with `-OpenFile <name>` (sample server only):
/// the same handler iOS calls, with a file the app writes itself. The sample
/// server picks its answer by the name (see `SampleServer.analyse`).
final class AddPaddleTests: AppTestCase {
    func testSignedOutTheListDoesNotOfferToAddAFile() {
        XCTAssertTrue(element("sample-notice").waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Add paddle"].exists)
    }

    func testSignedInTheListOffersToAddAFile() {
        signInAndWait()
        XCTAssertTrue(app.buttons["Add paddle"].waitForExistence(timeout: 10))
    }

    func testAFileOpenedWhileSignedOutIsAddedAfterSignIn() {
        relaunch(opening: "Morning.gpx", reset: true)
        let waiting = element("add-notice")
        XCTAssertTrue(waiting.waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Sign in to add Morning.gpx.").exists)
        app.buttons["add-notice-action"].tap()
        fill(email: "pat@example.com", password: "Password123")
        app.buttons["sign-in-submit"].tap()

        XCTAssertTrue(text(containing: "Paddle added.").waitForExistence(timeout: 15))
        app.buttons["add-notice-action"].tap()
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10), "opens the new paddle")
    }

    func testClosingTheSignInCardForgetsTheFile() {
        relaunch(opening: "Morning.gpx", reset: true)
        XCTAssertTrue(element("add-notice").waitForExistence(timeout: 10))
        app.buttons["add-notice-close"].tap()
        XCTAssertTrue(element("add-notice").waitForNonExistence(timeout: 5))
        signInAndWait()
        XCTAssertFalse(text(containing: "Paddle added.").waitForExistence(timeout: 3), "nothing was added")
    }

    func testAFileThatWasAlreadyThereSaysSo() {
        signInAndWait()
        relaunch(opening: "duplicate.gpx", reset: false)
        XCTAssertTrue(text(containing: "You've already added this paddle.").waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["add-notice-action"].label, "Open paddle")
    }

    func testAFileTheServerCannotReadSaysWhy() {
        signInAndWait()
        relaunch(opening: "unreadable.gpx", reset: false)
        XCTAssertTrue(text(containing: "That file has too few GPS points to analyse.").waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["add-notice-action"].exists, "a failure only closes")
        app.buttons["add-notice-close"].tap()
        XCTAssertTrue(element("add-notice").waitForNonExistence(timeout: 5), "Close puts it away")
    }

    func testTheOutcomePassesTheAccessibilityAudit() throws {
        signInAndWait()
        relaunch(opening: "unreadable.gpx", reset: false)
        XCTAssertTrue(element("add-notice").waitForExistence(timeout: 15))
        try audit()
    }

    /// Starts the app again as if iOS had handed it `name`; signed out first
    /// with `reset`.
    private func relaunch(opening name: String, reset: Bool) {
        app.terminate()
        app.launchArguments = ["-SampleServer", "-OpenFile", name] + (reset ? ["-ResetAccount"] : [])
        app.launch()
    }
}
