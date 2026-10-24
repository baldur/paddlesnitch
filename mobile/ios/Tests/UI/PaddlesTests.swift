import XCTest

/// The Paddles flows.
final class PaddlesTests: AppTestCase {
    func testTheListShowsTheSamplePaddlesWithTheLogbook() {
        XCTAssertTrue(element("sample-notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("logbook").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-motion").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-strava").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
        XCTAssertTrue(text(containing: "Also recorded by Strava").exists)
    }

    func testOpeningAPaddleShowsItsStatsNoteAndSummary() {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Headwind on the way back.").exists)
        XCTAssertTrue(text(containing: "from the SW").exists)
    }

    func testAPaddleWithoutGPSSaysWhyThereIsNoMap() {
        open("pdl-motion")
        XCTAssertTrue(text(containing: "The GPS lost the sky").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "PADDLING").exists)
    }

    func testYouListsTheAccountPages() {
        tab("You").tap()
        XCTAssertTrue(app.buttons["Privacy policy"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Account settings"].exists)
    }

    // MARK: Apple's accessibility audit on every screen

    func testTheListPassesTheAccessibilityAudit() throws {
        XCTAssertTrue(element("logbook").waitForExistence(timeout: 10))
        // iOS 26+ draws the tab bar as glass floating over the list, and the
        // rows scrolling under it are blurred on purpose. The contrast check
        // measures them anyway, so contrast is checked with the list scrolled
        // to its end, where no row is under the bar.
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast]))
        scrollTo("paddle-pdl-river")
        app.swipeUp()
        try audit(.contrast)
    }

    func testAPaddlePassesTheAccessibilityAudit() throws {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10))
        try audit()
    }

    func testANoGPSPaddlePassesTheAccessibilityAudit() throws {
        open("pdl-motion")
        XCTAssertTrue(text(containing: "The GPS lost the sky").waitForExistence(timeout: 10))
        try audit()
    }

    func testYouPassesTheAccessibilityAudit() throws {
        tab("You").tap()
        XCTAssertTrue(app.buttons["Privacy policy"].waitForExistence(timeout: 10))
        try audit()
    }
}
