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
        XCTAssertTrue(element("logbook").waitForExistence(timeout: 10))
        try checkWholeScreen()
    }

    func testAPaddleAtTheLargestTextSize() throws {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(text(containing: "RIVER").exists, "the last stat is still there")
        XCTAssertTrue(text(containing: "29 s at 1:23").exists, "and the rests, at the end")
    }

    func testYouAtTheLargestTextSize() throws {
        tab("You").tap()
        XCTAssertTrue(app.buttons["Privacy policy"].waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(text(containing: "Version").exists)
    }

    func testForgotPasswordAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        scrollToElement(app.buttons["Forgot password?"]).tap()
        XCTAssertTrue(element("forgot-explainer").waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["forgot-submit"].exists)
    }

    func testAccountAtTheLargestTextSize() throws {
        signInAndWait()
        tab("You").tap()
        let row = app.buttons["Account"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(element("account-terms").waitForExistence(timeout: 10))
        try checkWholeScreen(last: app.buttons["Delete my account"])
    }

    /// "Confirm your email" (#702) at the largest size, top to bottom.
    /// Scrolls to each element and checks for clipped text there: each
    /// check resizes the text in place and a long page jumps back up, so
    /// swiping from the top can't count on keeping its place.
    private func checkScreen(at elements: [XCUIElement]) throws {
        try audit(.textClipped)
        for element in elements {
            for _ in 0..<2 where !(element.exists && isReadable(element)) { scrollToElement(element) }
            XCTAssertTrue(element.exists && isReadable(element), "reached \(element)")
            try audit(.textClipped)
        }
    }

    func testTrackersAtTheLargestTextSize() throws {
        signInAndWait()
        tab("You").tap()
        scrollToElement(app.buttons["Devices"]).tap()
        XCTAssertTrue(app.navigationBars["Devices"].waitForExistence(timeout: 10))
        XCTAssertTrue(element("tracker-C0FFEE01").waitForExistence(timeout: 10))
        try checkScreen(at: [element("tracker-C0FFEE02"), element("tracker-BADC0DE9")])
    }

    func testTheCodeStepAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        scrollToElement(app.buttons["Create account"].firstMatch).tap()
        // The Terms first, before a keyboard covers half the form; then the
        // password field's Go sends it.
        scrollToElement(element("terms-checkbox")).tap()
        type("new@example.com", into: scrollToElement(app.textFields["Email"]))
        type("New", into: scrollToElement(app.textFields["Display name"]))
        type("Secret123\n", into: scrollToElement(app.secureTextFields["Password"]))
        XCTAssertTrue(element("code-explainer").waitForExistence(timeout: 10))
        declineSavingPassword()
        dismissKeyboard()
        try checkScreen(at: [
            app.textFields["code-field"], app.buttons["sign-in-submit"], app.buttons["send-new-code"],
            app.buttons["change-email"],
        ])
    }

    func testSignInAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["sign-in-submit"].exists)
    }
}
