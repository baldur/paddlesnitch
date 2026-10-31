import XCTest

/// Recording on the phone (signed in; debug builds only until uploads
/// arrive). The
/// simulator has no accelerometer or gyroscope, so this records the track
/// only; the sensors are proved in RecorderTests and on a real phone.
final class RecordTests: AppTestCase {

    override func setUp() async throws {
        try await super.setUp()
        // Ask for location afresh in every test (this ends the app).
        app.resetAuthorizationStatus(for: .location)
        app.launch()
    }

    func testARecordingIsSavedOnThePhone() throws {
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
        XCTAssertFalse(app.buttons["Close"].exists, "can't be closed while recording")
        try audit()

        let stop = element("record-stop")
        stop.tap()
        XCTAssertTrue(text(containing: "Keep your finger on it").appears(timeout: 5), "a tap doesn't stop it")
        XCTAssertTrue(element("record-recording").exists)
        stop.press(forDuration: 1.5)

        XCTAssertTrue(text(containing: "Saved on this iPhone").appears(timeout: 10))
        XCTAssertTrue(text(containing: "track_").exists, "named as the tracker names its files")
        try audit()
        app.buttons["record-done"].tap()
        XCTAssertTrue(app.buttons["record"].appears(timeout: 5), "back on Paddles")
    }

    /// The app signs out on its own when the server refuses a refresh (a
    /// password reset elsewhere). The record screen and its Stop stay, and
    /// the paddle is saved in the account it was started in.
    func testASignOutMidRecordingKeepsTheScreenAndItsStop() throws {
        app.terminate()
        app.launchArguments += ["-SignOutWhileRecording"]
        app.launch()
        try startRecording(allow: true)
        XCTAssertTrue(element("record-recording").appears(timeout: 10))
        XCTAssertFalse(element("record-recording").disappears(timeout: 5), "still recording after the sign-out")
        element("record-stop").press(forDuration: 1.5)
        XCTAssertTrue(text(containing: "Saved on this iPhone").appears(timeout: 10))
        app.buttons["record-done"].tap()
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
