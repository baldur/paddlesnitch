import XCTest

/// The trackers screen against the sample server (the account.devices
/// fixtures: up to date; quiet with an update and a crash; removed).
final class TrackersTests: AppTestCase {
    private func openTrackers() {
        signInAndWait()
        selectTab("You")
        let row = app.buttons["Devices"]
        XCTAssertTrue(row.appears(timeout: 10))
        row.tap()
        XCTAssertTrue(app.navigationBars["Devices"].appears(timeout: 10))
    }

    func testTheCardsSayWhatTheServerSays() {
        openTrackers()
        XCTAssertTrue(text(containing: "Tracker C0FFEE01").appears(timeout: 10))
        XCTAssertTrue(text(containing: "up to date").exists)
        XCTAssertTrue(text(containing: "update pending (0.18.2)").exists)
        XCTAssertTrue(text(containing: "crashed").exists)
        XCTAssertTrue(text(containing: "quiet").exists, "in words, not colour alone")
        XCTAssertTrue(scrollToElement(text(containing: "removed")).exists, "a removed tracker with recordings")
    }

    func testARecordingThatBecameAPaddleOpensIt() {
        openTrackers()
        let card = element("tracker-C0FFEE01")
        XCTAssertTrue(card.appears(timeout: 10))
        card.tap()
        let river = element("recording-rec-river")
        XCTAssertTrue(river.appears(timeout: 10))
        XCTAssertTrue(element("recording-rec-no-fix").exists)
        XCTAssertTrue(text(containing: "not a paddle").exists)
        river.tap()
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10), "the paddle opens")
    }

    func testRemovingATrackerAsksFirstAndKeepsItsCard() {
        openTrackers()
        let card = element("tracker-C0FFEE02")
        XCTAssertTrue(card.appears(timeout: 10))
        card.tap()
        scrollToElement(app.buttons["Remove tracker"]).tap()
        XCTAssertTrue(text(containing: "Remove this tracker?").appears(timeout: 10), "asks first")
        app.buttons["confirm-remove-tracker"].tap()
        XCTAssertTrue(app.buttons["Remove tracker"].disappears(timeout: 10))
        XCTAssertTrue(
            text(containing: "no longer on your account").appears(timeout: 10), "says what removed means")
    }

    func testTheTrackersPassTheAccessibilityAudit() throws {
        openTrackers()
        XCTAssertTrue(text(containing: "Tracker C0FFEE01").appears(timeout: 10))
        try audit()
        element("tracker-C0FFEE01").tap()
        XCTAssertTrue(element("recording-rec-river").appears(timeout: 10))
        try audit()
    }
}
