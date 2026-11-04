import XCTest

/// Recording on the phone (signed in) and uploading it (C3). The simulator
/// has no accelerometer or gyroscope, so this records the track only; the
/// sensors are proved in RecorderTests and on a real phone, the uploads'
/// order and pieces in PhoneUploadTests.
final class RecordTests: AppTestCase {

    override func setUp() async throws {
        try await super.setUp()
        // Ask for location afresh in every test (this ends the app).
        app.resetAuthorizationStatus(for: .location)
        app.launch()
    }

    func testARecordingGoesBackToPaddlesAndUploads() throws {
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        let gps = element("record-gps").label
        XCTAssertTrue(
            ["Waiting for GPS", "GPS fix"].contains(gps) || gps.hasPrefix("GPS lost"), "agreed words: \(gps)")
        let time = element("record-time")
        let first = time.label
        XCTAssertTrue(first.hasPrefix("Time, "), "the time since it started, spoken: \(first)")
        XCTAssertTrue(poll(timeout: 5) { time.label != first }, "the clock runs")
        // The recorder core has no live values yet: "—" (spoken "not measured
        // yet"), never a guess.
        XCTAssertEqual(element("record-stroke-rate").label, "Stroke rate, not measured yet")
        XCTAssertTrue(text(containing: "—").exists)
        // The simulator has no motion sensors: GPS only, and it says so.
        XCTAssertTrue(element("record-no-motion").exists)
        XCTAssertFalse(element("record-motion").exists, "and no motion line: the core would read as a fault")
        try audit()

        let stop = element("record-stop")
        stop.tap()
        XCTAssertTrue(text(containing: "Keep holding to stop.").appears(timeout: 5), "a tap doesn't stop it")
        XCTAssertTrue(element("record-recording").exists)
        stop.press(forDuration: 2)

        // Back to Paddles; the sample server takes it and makes a paddle.
        XCTAssertTrue(app.buttons["record"].appears(timeout: 10), "back on Paddles")
        XCTAssertFalse(element("recording-line").exists)
        let paddle = element("paddle-pdl-phone")
        XCTAssertTrue(paddle.appears(timeout: 20), "uploaded, and in the list")
        XCTAssertFalse(element("upload-line").exists)
        // #789: the phone's paddle says Phone, never Tracker.
        XCTAssertTrue(paddle.label.contains("· Phone"), "labelled Phone: \(paddle.label)")
        XCTAssertFalse(paddle.label.contains("Tracker"))
        paddle.tap()
        XCTAssertTrue(text(containing: "PHONE · K1").appears(timeout: 10), "the paddle page says Phone")
    }

    /// Hide while recording hides the screen and keeps recording: every
    /// screen says so at the top, and opens it again.
    func testClosingTheScreenKeepsRecording() throws {
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        XCTAssertTrue(text(containing: "Recording carries on.").exists)
        app.buttons["record-hide"].tap()
        let line = element("recording-line")
        XCTAssertTrue(line.appears(timeout: 10))
        XCTAssertTrue(line.label.hasPrefix("Recording, "), line.label)
        try auditPaddles()
        // At the top of every screen, not only Paddles.
        selectTab("You")
        XCTAssertTrue(line.appears(timeout: 5), "on You too")
        XCTAssertFalse(element("upload-line").exists, "the running recording isn't waiting to upload")
        line.tap()
        XCTAssertTrue(element("record-recording").appears(timeout: 10), "the same recording")
        element("record-stop").press(forDuration: 2)
        XCTAssertTrue(line.disappears(timeout: 10))
    }

    /// Let go before 1.5 s and it keeps recording: only a full hold stops
    /// (a bump in a drybag mustn't end a paddle). 0.5 s and 1.2 s, short
    /// and nearly there; each wait outlasts the 1.5 s so a late stop shows.
    func testLettingGoEarlyKeepsRecording() throws {
        try startRecording(allow: true)
        let stop = element("record-stop")
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        for seconds in [0.5, 1.2] {
            stop.press(forDuration: seconds)
            XCTAssertFalse(element("record-recording").disappears(timeout: 2), "still recording after \(seconds) s")
        }
        // The same button stops on a full hold, so the short presses reached
        // it (a press shows nothing else: it isn't a tap, so no hint).
        stop.press(forDuration: 2)
        XCTAssertTrue(element("record-recording").disappears(timeout: 10), "a full hold stops it")
    }

    func testWhileTheServerIsDownTheRecordingWaits() throws {
        try record(with: "-UploadsDown")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("Waiting to upload") }, line.label)
        try auditPaddles()
    }

    func testATrackWithNoGPSFixSaysSoUntilClosed() throws {
        try record(with: "-UploadsNoFix")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("No GPS fix") }, line.label)
        app.buttons["upload-line-close"].tap()
        XCTAssertTrue(line.disappears(timeout: 5))
    }

    func testARecordingTheServerWontTakeIsKeptWithReportAnIssue() throws {
        try record(with: "-UploadsRefused")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("Couldn’t upload this recording") })
        XCTAssertEqual(app.buttons["report-issue"].label, "Report an issue")
        try auditPaddles()
    }

    /// The owner removed this phone on Devices: the recording stays until
    /// Add phone again adds the phone again.
    func testARemovedPhoneUploadsAfterAddPhoneAgain() throws {
        try record(with: "-PhoneRemoved")
        let line = element("upload-line")
        XCTAssertTrue(
            poll(timeout: 20) {
                line.exists && line.label.contains("This phone was removed from your account. 1 recording is waiting.")
            })
        let addAgain = app.buttons["add-phone-again"]
        XCTAssertEqual(addAgain.label, "Add phone again")
        addAgain.tap()
        XCTAssertTrue(element("paddle-pdl-phone").appears(timeout: 20), "uploaded, and in the list")
        XCTAssertFalse(line.exists)
    }

    /// The next Start adds a removed phone again too, and what was waiting
    /// goes once that recording stops.
    func testARemovedPhoneIsAddedAgainAtTheNextStart() throws {
        try record(with: "-PhoneRemoved")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("This phone was removed") })
        openRecord()
        app.buttons["record-start"].tap()
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        element("record-stop").press(forDuration: 2)
        XCTAssertTrue(element("paddle-pdl-phone").appears(timeout: 20), "uploaded, and in the list")
        XCTAssertFalse(text(containing: "This phone was removed").exists)
    }

    /// The account was deleted on the website (410 with accountDeleted): the
    /// app signs out and the sign-in screen says why, in the server's words.
    func testADeletedAccountSignsOutAndSaysWhy() {
        app.terminate()
        app.launchArguments += ["-AccountDeleted"]
        app.launch()
        signIn()
        XCTAssertTrue(element("sample-notice").appears(timeout: 15), "signed out")
        // The sign-in sheet can still be closing over it: 0.7 s after Sign
        // in, the tap found it covered (#873's CI, newest iOS). And a sheet
        // asked to open while another closes is dropped without a word: wait
        // for it to go, then tap until the new one is up.
        XCTAssertTrue(app.buttons["sign-in-submit"].disappears(timeout: 10), "the sign-in sheet closed")
        let deleted = element("sign-in-account-deleted")
        for _ in 0..<3 {
            tapWhenClear(app.buttons["sample-notice-action"])
            if deleted.appears(timeout: 5) { break }
        }
        XCTAssertTrue(deleted.exists && text(containing: "This account was deleted").exists)
    }

    /// The app signs out on its own when the server refuses a refresh (a
    /// password reset elsewhere). The record screen and its Stop stay, and
    /// the recording stays in the account it was started in.
    func testASignOutMidRecordingKeepsTheScreenAndItsStop() throws {
        app.terminate()
        app.launchArguments += ["-SignOutWhileRecording"]
        app.launch()
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        XCTAssertFalse(element("record-recording").disappears(timeout: 5), "still recording after the sign-out")
        element("record-stop").press(forDuration: 2)
        XCTAssertTrue(element("sample-notice").appears(timeout: 10), "signed out behind it")
    }

    func testWithoutLocationItSaysWhereToTurnItOn() throws {
        try startRecording(allow: false)
        XCTAssertTrue(element("record-location-off").appears(timeout: 10))
        XCTAssertTrue(app.buttons["record-settings"].exists)
        XCTAssertFalse(app.buttons["record-start"].exists)
        try audit()
    }

    func testSignedOutThereIsNothingToRecordInto() {
        XCTAssertTrue(element("sample-notice").appears(timeout: 10))
        XCTAssertFalse(app.buttons["record"].exists)
    }

    /// The Paddles list with a line above the logbook: the "All paddles"
    /// header sits half under the tab bar, which the audit calls clipped.
    /// Clipping is LargeTextTests' job, on the whole screen.
    private func auditPaddles() throws {
        try audit(XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped]))
    }

    /// Records a few seconds with the sample server answering uploads as
    /// `argument` says, and stops.
    private func record(with argument: String) throws {
        app.terminate()
        app.launchArguments += [argument]
        app.launch()
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        element("record-stop").press(forDuration: 2)
        XCTAssertTrue(app.buttons["record"].appears(timeout: 10), "back on Paddles")
    }

    private func startRecording(allow: Bool) throws {
        signInAndWait()
        openRecord()
        let start = app.buttons["record-start"]
        try audit()
        start.tap()
        answerLocation(allow ? "While Using" : "Don")
    }
}

extension AppTestCase {
    /// Opens the record screen from Paddles. Asked for while the sign-in sheet
    /// is still closing (slower at the largest text size), iOS drops it
    /// without a word, so it taps again until the screen is up.
    func openRecord(file: StaticString = #filePath, line: UInt = #line) {
        let record = app.buttons["record"]
        XCTAssertTrue(record.appears(timeout: 10), file: file, line: line)
        for _ in 0..<3 {
            record.tap()
            if app.navigationBars["Record"].appears(timeout: 3) { return }
        }
        XCTFail("the record screen didn't open", file: file, line: line)
    }

    /// Answers iOS's location question with the button whose label contains
    /// `choice`. Tapped while the alert is still growing in, the tap misses
    /// and the alert stays (#767's run 41247348414, newest iOS), so it taps
    /// until the alert goes.
    func answerLocation(_ choice: String, file: StaticString = #filePath, line: UInt = #line) {
        let answer = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", choice)
        ).firstMatch
        XCTAssertTrue(answer.appears(timeout: 10), "iOS asks for location", file: file, line: line)
        for _ in 0..<3 {
            answer.tap()
            if answer.disappears(timeout: 3) { return }
        }
        XCTFail("the location alert didn't go", file: file, line: line)
    }
}
