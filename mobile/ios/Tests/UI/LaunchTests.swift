import XCTest

final class LaunchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchesToTheHomeScreen() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["paddlesnitch"].waitForExistence(timeout: 10))
    }

    /// Apple's own audit: missing labels, contrast, clipped Dynamic Type,
    /// small hit targets.
    @MainActor
    func testHomeScreenPassesTheAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["paddlesnitch"].waitForExistence(timeout: 10))
        try app.performAccessibilityAudit()
    }
}
