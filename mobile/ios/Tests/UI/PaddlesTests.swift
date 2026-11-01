import XCTest

/// The Paddles flows.
final class PaddlesTests: AppTestCase {
    func testTheListShowsTheSamplePaddlesWithTheLogbook() {
        XCTAssertTrue(element("sample-notice").appears(timeout: 10))
        XCTAssertTrue(element("logbook").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-motion").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-strava").exists)
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
        XCTAssertTrue(scrollToElement(text(containing: "Also recorded by Strava")).exists)
    }

    func testOpeningAPaddleShowsItsStatsNoteAndSummary() {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertTrue(text(containing: "Headwind on the way back.").exists)
        XCTAssertTrue(text(containing: "from the SW").exists)
    }

    func testAPaddleShowsItsSpeedLegendEffortsAndRests() {
        open("pdl-river")
        XCTAssertTrue(text(containing: "Speed colours: blue 17:44/500, red 2:31/500").appears(timeout: 10))
        XCTAssertTrue(scrollToElement(text(containing: "Effort 1 at 1:53")).exists)
        XCTAssertTrue(text(containing: "1:06 · 2:31/500 · 64 spm").exists)
        XCTAssertTrue(text(containing: "29 s at 1:23").exists)
    }

    /// Data has no rounded corners (design system): the speed legend's bar is
    /// square, as on Android. Its top-left corner, a third of a point in, is
    /// the bar's colour, where a rounded end would show the card behind it.
    func testTheSpeedLegendIsSquare() {
        open("pdl-river")
        let legend = element("speed-legend")
        XCTAssertTrue(legend.appears(timeout: 10))
        let shot = legend.screenshot().image
        guard let pixels = Pixels(shot) else { return XCTFail("no pixels") }
        // The bar starts 16 pt in and 8 pt down (the legend's padding), 6 pt tall.
        let corner = pixels.at(x: 16.4, y: 8.4)
        let bar = pixels.at(x: 16.4, y: 11)
        let card = pixels.at(x: 4, y: 4)
        XCTAssertFalse(bar.near(card), "the bar is found: \(bar) vs \(card)")
        XCTAssertTrue(corner.near(bar), "the corner is the bar's colour: \(corner) vs \(bar)")
    }

    func testAPaddleWithoutGPSSaysWhyThereIsNoMap() {
        open("pdl-motion")
        XCTAssertTrue(text(containing: "The GPS lost the sky").appears(timeout: 10))
        XCTAssertTrue(text(containing: "PADDLING").exists)
    }

    func testYouSignedOutOffersToSignIn() {
        selectTab("You")
        XCTAssertTrue(app.buttons["Privacy policy"].appears(timeout: 10))
        XCTAssertTrue(app.buttons["Sign in"].exists)
        XCTAssertFalse(app.buttons["Account settings"].exists, "account pages need an account")
    }

    // MARK: Apple's accessibility audit on every screen

    func testTheListPassesTheAccessibilityAudit() throws {
        XCTAssertTrue(element("logbook").appears(timeout: 10))
        try audit()
    }

    func testAPaddlePassesTheAccessibilityAudit() throws {
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        try audit()
    }

    /// Without the clipped-text check: it enlarges the text in place, the
    /// page re-lays out and jumps back up, and the audit then flags text it
    /// can't pin to an element (seen on iOS 17 CI). Clipping on this page is
    /// checked top to bottom by `LargeTextTests.testAPaddleAtTheLargestTextSize`.
    func testAPaddleScrolledToItsEffortsPassesTheAccessibilityAudit() throws {
        open("pdl-river")
        XCTAssertTrue(scrollToElement(text(containing: "29 s at 1:23")).appears(timeout: 10))
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped]))
    }

    func testANoGPSPaddlePassesTheAccessibilityAudit() throws {
        open("pdl-motion")
        XCTAssertTrue(text(containing: "The GPS lost the sky").appears(timeout: 10))
        try audit()
    }

    func testYouPassesTheAccessibilityAudit() throws {
        selectTab("You")
        XCTAssertTrue(app.buttons["Privacy policy"].appears(timeout: 10))
        try audit()
    }
}

/// A paddle saved before its summary was written, as a new upload is.
final class PendingSummaryTests: AppTestCase {
    override var launchArguments: [String] { ["-PendingSummaries"] }

    func testOpeningAPaddleWritesItsSummary() {
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(text(containing: "A short, sharp three minutes").appears(timeout: 10))
        XCTAssertFalse(text(containing: "Writing your summary").exists)
    }
}
