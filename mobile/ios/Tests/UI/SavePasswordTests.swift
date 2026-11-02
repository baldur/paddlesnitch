import XCTest

/// `make test-app` turns AutoFill Passwords off on its simulator, so iOS 26
/// never offers "Save Password?" over the next screen (it came late, after
/// the helpers' look for it, and cost three fixes). This fails if it comes
/// back, e.g. if Apple renames the setting. iOS 26 only: iOS 27 never asks,
/// and iOS 17 hasn't been checked. Run from Xcode on a simulator with
/// AutoFill on, it fails, as it should.
final class SavePasswordTests: AppTestCase {
    func testSavePasswordIsNotOfferedAfterSignUp() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.operatingSystemVersion.majorVersion == 26, "only iOS 26 asks")
        app.buttons["sample-notice-action"].tap()
        showCreateAccount()
        fill(email: "new@example.com", password: "Secret123")
        type("New", into: app.textFields["Display name"])
        element("terms-checkbox").tap()
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(element("code-explainer").appears(timeout: 10))
        // It came up to ~10 s after the password went; look for 20.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let offered = poll(timeout: 20) { springboard.buttons["Not Now"].exists || app.buttons["Not Now"].exists }
        XCTAssertFalse(offered, "Save Password? came up: is AutoFill off on this simulator (scripts/autofill-off.sh)?")
    }
}
