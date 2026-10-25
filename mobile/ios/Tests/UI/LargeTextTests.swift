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
            app.swipeUp()
            try audit(.textClipped)
        }
        if let last { XCTFail("never reached \(last)") }
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

    func testAccountAtTheLargestTextSize() throws {
        signInAndWait()
        tab("You").tap()
        let row = app.buttons["Account"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(element("account-terms").waitForExistence(timeout: 10))
        try checkWholeScreen(last: app.buttons["Delete my account"])
    }

    func testSignInAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["sign-in-submit"].exists)
    }
}
