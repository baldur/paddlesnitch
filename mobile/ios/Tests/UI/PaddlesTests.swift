import XCTest

/// The Paddles flows.
final class PaddlesTests: AppTestCase {
    func testTheListShowsTheSamplePaddlesWithTheLogbook() {
        XCTAssertTrue(element("sample-notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("logbook").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-motion").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-strava").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
        XCTAssertTrue(scrollToElement(text(containing: "Also recorded by Strava")).exists)
    }

    func testOpeningAPaddleShowsItsStatsNoteAndSummary() {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Headwind on the way back.").exists)
        XCTAssertTrue(text(containing: "from the SW").exists)
    }

    func testAPaddleShowsItsSpeedLegendEffortsAndRests() {
        open("pdl-river")
        XCTAssertTrue(text(containing: "Speed colours: blue 17:44/500, red 2:31/500").waitForExistence(timeout: 10))
        XCTAssertTrue(scrollToElement(text(containing: "Effort 1 at 1:53")).exists)
        XCTAssertTrue(text(containing: "1:06 · 2:31/500 · 64 spm").exists)
        XCTAssertTrue(text(containing: "29 s at 1:23").exists)
    }

    func testAPaddleWithoutGPSSaysWhyThereIsNoMap() {
        open("pdl-motion")
        XCTAssertTrue(text(containing: "The GPS lost the sky").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "PADDLING").exists)
    }

    func testYouSignedOutOffersToSignIn() {
        tab("You").tap()
        XCTAssertTrue(app.buttons["Privacy policy"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Sign in"].exists)
        XCTAssertFalse(app.buttons["Account settings"].exists, "account pages need an account")
    }

    // MARK: Apple's accessibility audit on every screen

    func testTheListPassesTheAccessibilityAudit() throws {
        XCTAssertTrue(element("logbook").waitForExistence(timeout: 10))
        try audit()
    }

    func testAPaddlePassesTheAccessibilityAudit() throws {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").waitForExistence(timeout: 10))
        try audit()
    }

    func testAPaddleScrolledToItsEffortsPassesTheAccessibilityAudit() throws {
        open("pdl-river")
        XCTAssertTrue(scrollToElement(text(containing: "29 s at 1:23")).waitForExistence(timeout: 10))
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

/// A paddle saved before its summary was written, as a new upload is.
final class PendingSummaryTests: AppTestCase {
    override var launchArguments: [String] { ["-PendingSummaries"] }

    func testOpeningAPaddleWritesItsSummary() {
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(text(containing: "A short, sharp three minutes").waitForExistence(timeout: 10))
        XCTAssertFalse(text(containing: "Writing your summary").exists)
    }
}
