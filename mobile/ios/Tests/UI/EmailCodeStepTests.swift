import XCTest

/// "Confirm your email" (#702), against the sample server: code `123456`
/// works; una@example.com never entered hers, so signing in asks for it.
final class EmailCodeStepTests: AppTestCase {
    private func startAccount() {
        app.buttons["sample-notice-action"].tap()
        app.buttons["Create account"].firstMatch.tap()
        let name = app.textFields["Display name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        fill(email: "new@example.com", password: "Secret123")
        type("New", into: name)
        element("terms-checkbox").tap()
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(element("code-explainer").waitForExistence(timeout: 10))
        declineSavingPassword()
        waitForTheCodeKeyboard()
    }

    func testCreatingAnAccountAsksForTheCodeWithoutTabs() {
        startAccount()
        XCTAssertTrue(app.navigationBars["Confirm your email"].exists)
        XCTAssertTrue(text(containing: "new@example.com").exists)
        XCTAssertFalse(app.buttons["Create account"].exists, "no tabs during the code")
        XCTAssertEqual(app.buttons["sign-in-submit"].label, "Confirm email")
        // The code first, while the field has the keyboard it took; then the
        // keyboard away to see the buttons under it.
        typeWhenFocused("123456", into: app.textFields["code-field"])
        dismissKeyboard()
        XCTAssertFalse(scrollToElement(app.buttons["send-new-code"]).isEnabled, "30 seconds before another")
        tapWhenClear(app.buttons["sign-in-submit"])
        XCTAssertTrue(element("sample-notice").waitForNonExistence(timeout: 15), "signed in")
    }

    func testAWrongCodeSaysSo() {
        startAccount()
        typeWhenFocused("000000", into: app.textFields["code-field"])
        tapWhenClear(app.buttons["sign-in-submit"])
        XCTAssertTrue(text(containing: "That code is not valid.").waitForExistence(timeout: 10))
    }

    func testChangeEmailGoesBackToCreateAccount() {
        startAccount()
        tapWhenClear(app.buttons["change-email"])
        XCTAssertTrue(app.textFields["Display name"].waitForExistence(timeout: 10))
        XCTAssertFalse(element("code-explainer").exists)
    }

    func testSigningInBeforeTheCodeAsksForIt() {
        app.buttons["sample-notice-action"].tap()
        fill(email: "una@example.com", password: "Password123")
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(element("code-status").waitForExistence(timeout: 10))
        declineSavingPassword()
        XCTAssertTrue(text(containing: "Confirm your email first.").exists)
        XCTAssertFalse(element("sign-in-error").exists, "a status, not an error")
        typeWhenFocused("123456", into: app.textFields["code-field"])
        tapWhenClear(app.buttons["sign-in-submit"])
        XCTAssertTrue(element("sample-notice").waitForNonExistence(timeout: 15), "signed in")
    }

    /// The step as read after putting the keyboard away (Done), so the
    /// buttons under it are part of the audit.
    func testTheCodeStepPassesTheAccessibilityAudit() throws {
        startAccount()
        dismissKeyboard()
        try audit()
    }
}
