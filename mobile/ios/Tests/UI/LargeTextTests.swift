import XCTest

/// Every screen at the largest accessibility text size: nothing is cut off,
/// and the content is still all there. This replaces the audit's own Dynamic
/// Type check (see `AppTestCase.audit`).
final class LargeTextTests: AppTestCase {
    override var launchArguments: [String] {
        ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    }

    /// Scrolls the screen from top to bottom, checking for clipped text at
    /// each step.
    private func checkWholeScreen() throws {
        try audit(.textClipped)
        for _ in 0..<12 {
            app.swipeUp()
            try audit(.textClipped)
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

    func testSignInAtTheLargestTextSize() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        try checkWholeScreen()
        XCTAssertTrue(app.buttons["sign-in-submit"].exists)
    }
}
