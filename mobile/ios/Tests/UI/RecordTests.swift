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
        XCTAssertTrue(first.contains("0:0"), "the time since it started")
        XCTAssertTrue(poll(timeout: 5) { time.label != first }, "the clock runs")
        // The recorder core has no live values yet: "—", never a guess.
        XCTAssertTrue(element("record-stroke-rate").label.contains("—"))
        // The simulator has no motion sensors: GPS only, and it says so.
        XCTAssertTrue(element("record-no-motion").exists)
        try audit()

        let stop = element("record-stop")
        stop.tap()
        XCTAssertTrue(text(containing: "Keep holding to stop.").appears(timeout: 5), "a tap doesn't stop it")
        XCTAssertTrue(element("record-recording").exists)
        stop.press(forDuration: 2)

        // Back to Paddles; the sample server takes it, so nothing waits.
        XCTAssertTrue(app.buttons["record"].appears(timeout: 10), "back on Paddles")
        XCTAssertFalse(element("recording-line").exists)
        XCTAssertTrue(element("upload-line").disappears(timeout: 15), "uploaded")
    }

    /// Close while recording hides the screen and keeps recording: Paddles
    /// says so, and opens it again.
    func testClosingTheScreenKeepsRecording() throws {
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        app.buttons["record-close"].tap()
        let line = element("recording-line")
        XCTAssertTrue(line.appears(timeout: 10))
        XCTAssertTrue(line.label.hasPrefix("Recording · 0:0"), line.label)
        try audit()
        line.tap()
        XCTAssertTrue(element("record-recording").appears(timeout: 10), "the same recording")
        element("record-stop").press(forDuration: 2)
        XCTAssertTrue(line.disappears(timeout: 10))
    }

    func testWhileTheServerIsDownTheRecordingWaits() throws {
        try record(with: "-UploadsDown")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("Waiting to upload") }, line.label)
        try audit()
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
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("Couldn't upload this recording") })
        XCTAssertEqual(app.buttons["upload-line-action"].label, "Report an issue")
        try audit()
    }

    /// The owner removed this phone on Devices: the recording stays until
    /// Upload now adds the phone again.
    func testARemovedPhoneUploadsAfterUploadNow() throws {
        try record(with: "-PhoneRemoved")
        let line = element("upload-line")
        XCTAssertTrue(poll(timeout: 20) { line.exists && line.label.contains("This phone was removed") })
        let uploadNow = app.buttons["upload-line-action"]
        XCTAssertEqual(uploadNow.label, "Upload now")
        uploadNow.tap()
        XCTAssertTrue(line.disappears(timeout: 15), "uploaded")
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
