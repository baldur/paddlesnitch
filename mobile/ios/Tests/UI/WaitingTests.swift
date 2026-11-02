import XCTest

/// The waiting helpers themselves.
final class WaitingTests: AppTestCase {
    /// No keyboard is nil, not a failed test: the keyboard can go between a
    /// look and a read of its frame (CI on #808 and #810).
    func testAFrameOfSomethingGoneIsNil() {
        XCTAssertTrue(app.buttons["sample-notice-action"].appears(timeout: 10))
        XCTAssertNil(app.keyboards.firstMatch.frameIfThere)
        app.buttons["sample-notice-action"].tap()
        let email = app.textFields["Email"]
        XCTAssertTrue(email.appears(timeout: 10))
        email.tap()
        XCTAssertTrue(email.waitForKeyboardFocus(timeout: 10))
        XCTAssertNotNil(app.keyboards.firstMatch.frameIfThere)
    }
}
