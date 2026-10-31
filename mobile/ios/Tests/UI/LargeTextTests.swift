import XCTest

/// Every screen at the largest accessibility text size: nothing is cut off,
/// and the content is still all there. This replaces the audit's own Dynamic
/// Type check (see `AppTestCase.audit`).
final class LargeTextTests: AppTestCase {
    override var launchArguments: [String] {
        ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    }

    /// Scrolls the screen from top to bottom, checking for clipped text at
    /// each step. With `last`, it goes on until that element is on screen: a
    /// long screen at this size can need more than twelve swipes.
    private func checkWholeScreen(last: XCUIElement? = nil) throws {
        try audit(.textClipped)
        for step in 0..<30 {
            if let last { if last.exists && isReadable(last) { return } } else if step == 12 { return }
            swipe(up: true)
            try audit(.textClipped)
        }
        if let last {
            XCTFail("never reached \(last): readable \(readableArea), its frame \(last.frame), exists \(last.exists)")
        }
    }

    func testTheListAtTheLargestTextSize() throws {
        XCTAssertTrue(element("logbook").appears(timeout: 10))
        try checkWholeScreen()
    }

    func testAPaddleAtTheLargestTextSize() throws {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(text(containing: "RIVER").exists, "the last stat is still there")
        XCTAssertTrue(text(containing: "29 s at 1:23").exists, "and the rests, at the end")
    }

    func testYouAtTheLargestTextSize() throws {
        selectTab("You")
        XCTAssertTrue(app.buttons["Privacy policy"].appears(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(text(containing: "Version").exists)
    }

    func testForgotPasswordAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].appears(timeout: 10))
        scrollToElement(app.buttons["Forgot password?"]).tap()
        XCTAssertTrue(element("forgot-explainer").appears(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["forgot-submit"].exists)
    }

    /// Scrolls to each element and checks for clipped text there. For a long
    /// List: each check resizes the text in place and the List jumps back up,
    /// so swiping from the top never reached the end of the Account screen.
    /// Reports on no element don't fail here (see `audit(unpinnedFails:)`).
    private func checkScreen(at elements: [XCUIElement]) throws {
        try audit(.textClipped, unpinnedFails: false)
        for element in elements {
            // Twice over if need be: the last check's jump may have undone
            // some of the way.
            // A check's jump can leave the row above or below, and a row not
            // on screen doesn't exist yet: look downwards, then upwards.
            for _ in 0..<2 where !(element.exists && isReadable(element)) { scrollToElement(element) }
            for _ in 0..<12 where !element.exists { app.swipeDown() }
            if element.exists && !isReadable(element) { scrollToElement(element) }
            XCTAssertTrue(element.exists, "reached \(element)")
            try audit(.textClipped, unpinnedFails: false)
            // The page jumps back after the audit returns: let it land before
            // the next row is looked for, or the row goes mid-look.
            Thread.sleep(forTimeInterval: 1)
        }
    }

    func testAccountAtTheLargestTextSize() throws {
        signInAndWait()
        openAccount()
        try checkScreen(at: [
            app.textFields["profile-handle"], app.buttons["profile-handle-save"], app.buttons["Download my data"],
            app.buttons["Delete my account"],
        ])
    }

    /// A Strava account's contact email block is the tallest row there is.
    func testAStravaAccountAtTheLargestTextSize() throws {
        let notice = app.buttons["sample-notice-action"]
        XCTAssertTrue(notice.appears(timeout: 10))
        notice.tap()
        scrollToElement(app.buttons["strava-sign-in"]).tap()
        XCTAssertTrue(signedIn(), "signed in")
        openAccount()
        XCTAssertTrue(app.textFields["contact-email"].appears(timeout: 10))
        try checkScreen(at: [
            app.buttons["contact-email-save"], app.textFields["profile-handle"], app.buttons["profile-handle-save"],
            app.buttons["Delete my account"],
        ])
    }

    func testTrackersAtTheLargestTextSize() throws {
        signInAndWait()
        selectTab("You")
        scrollToElement(app.buttons["Devices"]).tap()
        XCTAssertTrue(app.navigationBars["Devices"].appears(timeout: 10))
        XCTAssertTrue(element("tracker-C0FFEE01").appears(timeout: 10))
        try checkScreen(at: [element("tracker-C0FFEE02"), element("tracker-BADC0DE9")])
    }

    /// "Confirm your email" (#702) at the largest size, top to bottom.
    func testTheCodeStepAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        scrollToElement(app.buttons["Create account"].firstMatch).tap()
        // The Terms first, before a keyboard covers half the form; then the
        // password field's Go sends it.
        scrollToElement(element("terms-checkbox")).tap()
        type("new@example.com", into: scrollToElement(app.textFields["Email"]))
        type("New", into: scrollToElement(app.textFields["Display name"]))
        type("Secret123\n", into: scrollToElement(app.secureTextFields["Password"]))
        XCTAssertTrue(element("code-explainer").appears(timeout: 10))
        declineSavingPassword()
        waitForTheCodeKeyboard()
        dismissKeyboard()
        try checkScreen(at: [
            app.textFields["code-field"], app.buttons["sign-in-submit"], app.buttons["send-new-code"],
            app.buttons["change-email"],
        ])
    }

    /// Strava off: Google, the Strava help line and Email us.
    func testSignInWithStravaOffAtTheLargestTextSize() throws {
        app.terminate()
        app.launchArguments = ["-SampleServer", "-ResetAccount", "-StravaOff"] + launchArguments
        app.launch()
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].appears(timeout: 10))
        // Element by element: each check resizes the text and the sheet
        // jumps back to the top, so swiping from the top never got there.
        try checkScreen(at: [app.buttons["sign-in-submit"], app.buttons["google-sign-in"], app.buttons["email-us"]])
    }

    /// Strava off on a connected account: "Paused" and Disconnect.
    func testStravaPausedAtTheLargestTextSize() throws {
        app.terminate()
        app.launchArguments = ["-SampleServer", "-ResetAccount", "-StravaOff", "-StravaConnected"] + launchArguments
        app.launch()
        signInAndWait()
        openAccount()
        try checkScreen(at: [element("strava-connected"), app.buttons["Disconnect"]])
    }

    func testRecordAtTheLargestTextSize() throws {
        app.resetAuthorizationStatus(for: .location)  // ends the app
        app.launch()
        signInAndWait()
        openRecord()
        let start = app.buttons["record-start"]
        try checkWholeScreen(last: start)
        start.tap()
        answerLocation("While Using")  // asked again: the reset above
        let stop = element("record-stop")
        XCTAssertTrue(stop.appears(timeout: 10))
        try checkWholeScreen(last: stop)
        stop.press(forDuration: 1.5)
        XCTAssertTrue(app.buttons["record-done"].appears(timeout: 10))
        try checkWholeScreen(last: app.buttons["record-done"])
    }

    func testSignInAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].appears(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["sign-in-submit"].exists)
    }
}
