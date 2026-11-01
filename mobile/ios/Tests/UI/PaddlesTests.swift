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
    /// square, as on Android. It finds the bar's left and top edges in the
    /// pixels, then reads a third of a point in from that corner: the bar's
    /// colour when square, the card behind it when the end is rounded.
    func testTheSpeedLegendIsSquare() {
        open("pdl-river")
        let legend = element("speed-legend")
        XCTAssertTrue(legend.appears(timeout: 10))
        let shot = legend.screenshot().image
        guard let pixels = Pixels(shot) else { return XCTFail("no pixels") }
        let card = pixels.at(x: 2, y: 2)
        let step = 1 / pixels.scale
        // The bar is 6 pt tall near the top; scan its middle row for its left edge.
        let rows = stride(from: 0, to: shot.size.height / 2, by: step)
        guard
            let middle = rows.first(where: { y in
                !pixels.at(x: shot.size.width / 2, y: y).near(card)
            }).map({ $0 + 3 }),
            let left = stride(from: 0, to: shot.size.width / 2, by: step)
                .first(where: { !pixels.at(x: $0, y: middle).near(card) }),
            let top = rows.first(where: { !pixels.at(x: left + 1, y: $0).near(card) })
        else { return XCTFail("no bar in the legend") }
        let bar = pixels.at(x: left + 1, y: middle)
        let corner = pixels.at(x: left + 0.34, y: top + 0.34)
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
