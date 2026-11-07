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

    /// The system's back button stays (so the edge swipe works too): it
    /// is named after the paddle, or "Back". A synthesized edge swipe
    /// didn't trigger iOS 17's back gesture on CI, so this taps it.
    func testTheSystemBackButtonGoesBackToThePaddle() {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(["Tue, 1 Sep 2026", "Back"].contains(back.label), "the system's back button: \(back.label)")
        back.tap()
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

    /// The paddle page's call fails, then the screen's first: Try again
    /// on the screen fills the page's tiles too (one model). Every later
    /// call fails, so a reload on coming back would hide them.
    func testAFailedCallCanBeTriedAgain() {
        relaunch(with: "-MotionAnswersThirdOnly")
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "Couldn’t read this recording.").appears(timeout: 10))
        app.buttons["motion-try-again"].tap()
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(element("motion-on-paddle").appears(timeout: 10))
        XCTAssertFalse(element("motion-on-paddle").disappears(timeout: 3), "no reload on coming back")
    }

    func testARecordingThatIsGoneSaysSoWithoutTryAgain() {
        relaunch(with: "-MotionNotFound")
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "We can't find this recording").appears(timeout: 10))
        XCTAssertFalse(app.buttons["motion-try-again"].exists)
        app.buttons["Back to the paddle"].tap()
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
    }

    // MARK: On the paddle (README "On the paddle", #866)

    func testTheMeasuredPaddleShowsEvennessThenRollAndLinksToTheCharts() {
        signInAndWait()
        open("pdl-river")
        let section = scrollTo("motion-on-paddle")
        XCTAssertTrue(section.appears(timeout: 10))
        let evenness = section.descendants(matching: .any)["Evenness, 10%, uneven"]
        let roll = section.descendants(matching: .any)["Side-to-side roll, 5.8 degrees, typical lean"]
        XCTAssertTrue(evenness.exists && roll.exists, "the screen's two tiles, read in words")
        XCTAssertLessThan(evenness.frame.maxX, roll.frame.minX, "Evenness first, in one row")
        XCTAssertEqual(evenness.frame.minY, roll.frame.minY, accuracy: 1)
        let summary = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Summary:'"))
            .firstMatch
        let sameOuting = element("same-outing-pdl-river-watch")
        XCTAssertLessThan(summary.frame.maxY, section.frame.minY, "after the summary")
        XCTAssertLessThan(section.frame.maxY, sameOuting.frame.minY, "before the same-outing link")
        XCTAssertFalse(section.descendants(matching: .any)["Stroke rate, 64, strokes per minute"].exists)
        let link = section.buttons["motion-all-charts"]
        XCTAssertEqual(link.label, "All charts")
        XCTAssertGreaterThanOrEqual(link.frame.height, 44)
        keep("Boat motion on the paddle")
        link.tap()
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
        XCTAssertTrue(element("motion-on-paddle").exists, "still there on coming back, not loading again")
    }

    /// No motion file yet: nothing on the paddle; its button explains.
    func testNoMotionShowsNothingOnThePaddle() {
        signInAndWait()
        open("pdl-motion")
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
        XCTAssertFalse(element("motion-on-paddle").appears(timeout: 3))
    }

    func testUnmeasurableMotionShowsNothingOnThePaddle() {
        relaunch(with: "-MotionUnusable")
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
        XCTAssertFalse(element("motion-on-paddle").appears(timeout: 3))
    }

    func testAGoneRecordingShowsNothingOnThePaddle() {
        relaunch(with: "-MotionNotFound")
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
        XCTAssertFalse(element("motion-on-paddle").appears(timeout: 3))
    }

    func testAFailedCallShowsNothingOnThePaddle() {
        relaunch(with: "-MotionFails")
        signInAndWait()
        open("pdl-river")
        XCTAssertTrue(element("open-motion").appears(timeout: 10))
        XCTAssertFalse(element("motion-on-paddle").appears(timeout: 3))
    }

    func testOnlyYourOwnTrackerPaddleOffersIt() {
        // The samples have no account.
        open("pdl-river")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertFalse(element("open-motion").exists)
        XCTAssertFalse(element("motion-on-paddle").appears(timeout: 3))
        app.terminate()
        app.launch()
        signInAndWait()
        open("pdl-strava")
        XCTAssertTrue(text(containing: "PACE").appears(timeout: 10))
        XCTAssertFalse(element("open-motion").exists, "not from a tracker")
    }

    /// Roll and pitch never differ by colour alone (#855): the legend sits
    /// in its 34 pt band above the lines, roll's key is a solid line and
    /// pitch's a dashed one, as in the chart.
    func testStrokeShapeKeepsItsLegendAboveTheLinesAndDashesPitch() {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let chart = scrollTo("motion-excerpt")
        let shot = chart.screenshot().image
        guard let pixels = Pixels(shot) else { return XCTFail("no pixels") }
        let width = shot.size.width
        func isLine(_ c: Pixels.RGB) -> Bool { c.near(Self.roll) || c.near(Self.pitch) }
        // The keys, on the legend's centre line (y 17) in the right half.
        let row = stride(from: width / 2, to: width, by: 0.5).map { ($0, pixels.at(x: $0, y: 17)) }
        let rollKey = row.filter { $0.1.near(Self.roll) }.map(\.0)
        let pitchKey = row.filter { $0.1.near(Self.pitch) }.map(\.0)
        guard let rollStart = rollKey.min(), let rollEnd = rollKey.max(), let pitchStart = pitchKey.min(),
            let pitchEnd = pitchKey.max()
        else { return XCTFail("no keys on the legend's centre line") }
        XCTAssertEqual(rollKey.count, Int((rollEnd - rollStart) / 0.5) + 1, "roll's key is solid")
        XCTAssertGreaterThan(rollEnd - rollStart, 15, "roll's key is 18 pt of its line")
        let gaps = row.filter { $0.0 > pitchStart && $0.0 < pitchEnd && !$0.1.near(Self.pitch) }
        XCTAssertFalse(gaps.isEmpty, "pitch's key is dashed")
        XCTAssertGreaterThan(pitchStart, rollEnd, "roll, then pitch")
        var inBand = 0, belowBand = 0
        for x in stride(from: CGFloat(44), to: rollStart - 4, by: 1) {
            for y in stride(from: CGFloat(0), to: 34, by: 1) where isLine(pixels.at(x: x, y: y)) { inBand += 1 }
            for y in stride(from: CGFloat(34), to: 60, by: 1) where isLine(pixels.at(x: x, y: y)) { belowBand += 1 }
        }
        XCTAssertEqual(inBand, 0, "the lines stay below the legend band")
        XCTAssertGreaterThan(belowBand, 0, "the tallest roll reaches the top of the plot")
        keep(chart, "Stroke shape")
    }

    /// Each band of "Through the session" is outlined at full colour, over
    /// both fills (which alone are under 3:1 on the surface).
    func testThroughTheSessionOutlinesEachBandAtFullColour() {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let chart = scrollTo("motion-envelope")
        let shot = chart.screenshot().image
        guard let pixels = Pixels(shot) else { return XCTFail("no pixels") }
        let width = shot.size.width
        var rollColumns = 0, pitchSeen = false
        let columns = stride(from: CGFloat(60), to: width - 30, by: 9).map { $0 }
        for x in columns {
            let column = stride(from: CGFloat(34), to: shot.size.height - 26, by: 0.5).map { pixels.at(x: x, y: $0) }
            if column.contains(where: { $0.near(Self.roll, within: 40) }) { rollColumns += 1 }
            if column.contains(where: { $0.near(Self.pitch, within: 40) }) { pitchSeen = true }
        }
        XCTAssertEqual(rollColumns, columns.count, "roll's outline crosses every column")
        XCTAssertTrue(pitchSeen, "pitch's outline shows at full colour")
        keep(chart, "Through the session")
    }

    private func keep(_ chart: XCUIElement, _ name: String) {
        let shot = XCTAttachment(screenshot: chart.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// `split` and `green`, the roll and pitch colours.
    private static let roll = Pixels.RGB(r: 0xa7, g: 0x8b, b: 0xfa)
    private static let pitch = Pixels.RGB(r: 0x22, g: 0xc5, b: 0x5e)

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
