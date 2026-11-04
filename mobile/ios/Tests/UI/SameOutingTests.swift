import XCTest

/// Another recording of the same outing opens Compare on the website
/// (mobile/contract/README.md, "Same outing"). The sample server's
/// `paddles.list` has pdl-river also recorded by Strava (pdl-river-watch).
final class SameOutingTests: AppTestCase {
    /// Safari's own close button: "Done" up to iOS 26, an X ("Close") on 27.
    private var safariDone: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label IN {'Done', 'Close'}")).firstMatch
    }

    func testACardRowOpensCompareNotThePaddle() throws {
        signInAndWait()
        let row = scrollTo("same-outing-pdl-river-pdl-river-watch")
        XCTAssertEqual(row.label, "Compare with the recording from Strava", "one element, the arrow not read")
        XCTAssertEqual(row.elementType, .button)
        XCTAssertTrue(row.isHittable)
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped]))
        keep("Same-outing row in its card")
        row.tap()
        XCTAssertTrue(safariDone.appears(timeout: 10), "Compare opens in the in-app browser")
        safariDone.tap()
        XCTAssertTrue(element("logbook").appears(timeout: 10), "back on the list, the paddle not opened")
        XCTAssertFalse(text(containing: "PACE").exists)
    }

    func testThePaddlePageLinksTheOtherRecordingAfterTheSummary() throws {
        signInAndWait()
        open("pdl-river")
        let link = scrollTo("same-outing-pdl-river-watch")
        XCTAssertEqual(link.label, "Compare with the recording from Strava")
        XCTAssertEqual(link.elementType, .button)
        XCTAssertGreaterThanOrEqual(link.frame.height, 44)
        let summary = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Summary: '"))
            .firstMatch
        XCTAssertGreaterThanOrEqual(link.frame.minY, summary.frame.maxY, "after the summary")
        let efforts = text(containing: "Efforts and rests")
        XCTAssertLessThanOrEqual(link.frame.maxY, efforts.frame.minY, "before Efforts and rests")
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped]))
        link.tap()
        XCTAssertTrue(safariDone.appears(timeout: 10), "Compare opens in the in-app browser")
        safariDone.tap()
        XCTAssertTrue(link.appears(timeout: 10), "back on the paddle")
    }

    func testAPaddleWithNoOtherRecordingHasNoLinks() {
        signInAndWait()
        open("pdl-strava")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertFalse(anySameOutingComes(), "no links")
    }

    /// The links are extra: a failed call shows nothing, not an error.
    func testAFailedCallShowsNoLinksAndThePageAsItIs() {
        relaunch(with: "-SameOutingFails")
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(text(containing: "Headwind on the way back.").appears(timeout: 10))
        XCTAssertFalse(anySameOutingComes(), "no links")
        XCTAssertFalse(text(containing: "Couldn").exists)
    }

    func testAFailedWebCodeSaysSoAndLeavesTheList() {
        relaunch(with: "-WebCodeFails")
        signInAndWait()
        let row = scrollTo("same-outing-pdl-river-pdl-river-watch")
        row.tap()
        let alert = app.alerts["Couldn't open Compare. Please try again."]
        XCTAssertTrue(alert.appears(timeout: 10))
        alert.buttons["OK"].tap()
        XCTAssertFalse(safariDone.exists)
        XCTAssertTrue(row.isHittable && row.isEnabled, "it can be tried again")
        XCTAssertFalse(text(containing: "PACE").exists, "the paddle didn't open")
    }

    /// The samples have no account to compare in: their row is words, not
    /// a button.
    func testTheSamplesRowIsNotAButton() {
        let row = scrollTo("same-outing-pdl-river-pdl-river-watch")
        XCTAssertEqual(row.label, "Also recorded by Strava")
        XCTAssertNotEqual(row.elementType, .button)
        XCTAssertFalse(app.buttons["same-outing-pdl-river-pdl-river-watch"].exists)
    }

    /// The links come after the page: watch for 3 s, not one look.
    private func anySameOutingComes() -> Bool {
        let links = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'same-outing-'"))
        return poll(timeout: 3) { links.count > 0 }
    }

    private func relaunch(with argument: String) {
        app.terminate()
        app.launchArguments += [argument]
        app.launch()
    }
}
