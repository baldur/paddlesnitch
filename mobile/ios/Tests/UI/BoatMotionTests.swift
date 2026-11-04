import XCTest

/// Boat motion (mobile/contract/README.md, "Boat motion"). The sample
/// server measured pdl-river's recording (S0012); pdl-motion's (S0013) has
/// no motion file yet.
final class BoatMotionTests: AppTestCase {
    func testAMeasuredRecordingShowsTilesChartsAndNotes() throws {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        XCTAssertEqual(
            element("motion-envelope").label, "Roll and pitch through the session, reaching about 11 degrees")
        let roll = app.descendants(matching: .any)["Side-to-side roll, 5.8 degrees, typical lean"]
        XCTAssertTrue(roll.exists, "a tile is one element, read in words")
        XCTAssertTrue(app.descendants(matching: .any)["Stroke rate, 64, strokes per minute"].exists)
        XCTAssertTrue(scrollTo("motion-excerpt").exists)
        XCTAssertTrue(scrollTo("motion-histogram").exists)
        XCTAssertTrue(scrollToElement(text(containing: "What this can't tell you.")).exists)
        keep("Boat motion")
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped]))
    }

    /// The system's back button stays, so the edge swipe goes back.
    func testASwipeFromTheEdgeGoesBackToThePaddle() {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let window = app.windows.firstMatch
        let edge = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)))
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
    }

    /// Try again keeps working after a second failure (focus then goes
    /// back to the error: `BoatMotionModel.focusError`).
    func testTryAgainKeepsWorkingWhileItFails() {
        relaunch(with: "-MotionFails")
        openMotion("pdl-river")
        let again = app.buttons["motion-try-again"]
        XCTAssertTrue(again.appears(timeout: 10))
        again.tap()
        XCTAssertTrue(again.appears(timeout: 10))
        again.tap()
        XCTAssertTrue(again.appears(timeout: 10))
        XCTAssertTrue(text(containing: "Couldn’t read this recording.").exists)
    }

    func testNoMotionFileYetOpensTheTrackers() {
        openMotion("pdl-motion")
        XCTAssertTrue(text(containing: "No boat motion for this recording.").appears(timeout: 10))
        XCTAssertTrue(text(containing: "Motion data uploads after the GPS track.").exists)
        let open = app.buttons["motion-open-device"]
        XCTAssertEqual(open.label, "Open tracker")
        open.tap()
        XCTAssertTrue(app.navigationBars["Devices"].appears(timeout: 10), "You → Trackers")
    }

    func testMotionThatCouldNotBeMeasuredOffersNoTracker() {
        relaunch(with: "-MotionUnusable")
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "We couldn’t measure boat motion").appears(timeout: 10))
        XCTAssertFalse(app.buttons["motion-open-device"].exists)
        XCTAssertFalse(text(containing: "too few samples").exists, "never the engine's reason")
    }

    func testAFailedCallCanBeTriedAgain() {
        relaunch(with: "-MotionFailsOnce")
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "Couldn’t read this recording.").appears(timeout: 10))
        app.buttons["motion-try-again"].tap()
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
    }

    func testARecordingThatIsGoneSaysSoWithoutTryAgain() {
        relaunch(with: "-MotionNotFound")
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "We can't find this recording").appears(timeout: 10))
        XCTAssertFalse(app.buttons["motion-try-again"].exists)
        app.buttons["Back to the paddle"].tap()
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
    }

    func testOnlyYourOwnTrackerPaddleOffersIt() {
        // The samples have no account.
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertFalse(element("open-motion").exists)
        app.terminate()
        app.launch()
        signInAndWait()
        open("pdl-strava")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertFalse(element("open-motion").exists, "not from a tracker")
    }

    private func openMotion(_ paddle: String) {
        signInAndWait()
        open(paddle)
        let button = element("open-motion")
        XCTAssertTrue(button.appears(timeout: 10))
        button.tap()
    }

    private func relaunch(with argument: String) {
        app.terminate()
        app.launchArguments += [argument]
        app.launch()
    }
}
