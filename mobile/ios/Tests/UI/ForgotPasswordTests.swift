import XCTest

/// Forgot password from the sign-in sheet, against the sample server: code
/// `123456` works; kim@example.com's new password is set without signing in.
final class ForgotPasswordTests: AppTestCase {
    private func openForgotPassword(email: String) {
        app.buttons["sample-notice-action"].tap()
        let emailField = app.textFields["Email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 10))
        emailField.tap()
        emailField.typeText(email)
        app.buttons["Forgot password?"].tap()
        XCTAssertTrue(element("forgot-explainer").waitForExistence(timeout: 10))
    }

    private func sendCodeThenReset(code: String) {
        app.buttons["forgot-submit"].tap()
        let codeField = app.textFields["Code from the email"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 10))
        codeField.tap()
        codeField.typeText(code)
        let password = app.secureTextFields["New password"]
        password.tap()
        password.typeText("NewPassword1")
        app.buttons["forgot-submit"].tap()
    }

    func testTheCodeAndANewPasswordSignYouIn() {
        openForgotPassword(email: "pat@example.com")
        XCTAssertTrue(text(containing: "we'll send you a 6-digit code").exists)
        sendCodeThenReset(code: "123456")
        XCTAssertTrue(element("sample-notice").waitForNonExistence(timeout: 15), "signed in, sheet closed")
        XCTAssertTrue(element("logbook").waitForExistence(timeout: 10))
    }

    func testAWrongCodeSaysSo() {
        openForgotPassword(email: "pat@example.com")
        sendCodeThenReset(code: "000000")
        XCTAssertTrue(text(containing: "That code is wrong or has expired.").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Send a new code"].exists)
    }

    func testSetButNotSignedInGoesBackToSignInWithTheEmail() {
        openForgotPassword(email: "kim@example.com")
        sendCodeThenReset(code: "123456")
        XCTAssertTrue(element("sign-in-notice").waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["Email"].value as? String, "kim@example.com")
    }

    /// Without the clipped-text check: it flags a text field with text in
    /// it as clipped when it isn't (the sign-in form does the same once an
    /// email is typed; mobile/ios/CLAUDE.md). LargeTextTests checks this
    /// screen for clipping with the field empty.
    func testForgotPasswordPassesTheAccessibilityAudit() throws {
        openForgotPassword(email: "pat@example.com")
        settle()
        try audit(Self.withoutClipping)
        app.buttons["forgot-submit"].tap()
        XCTAssertTrue(app.textFields["Code from the email"].waitForExistence(timeout: 10))
        settle()
        try audit(Self.withoutClipping)
    }

    static let withoutClipping = XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast, .textClipped])

    /// The audit reads text mid-slide as clipped: wait until the pushed
    /// screen's first field stops moving.
    private func settle() {
        let field = app.textFields.firstMatch
        var last = CGRect.null
        for _ in 0..<20 where field.frame != last {
            last = field.frame
            usleep(150_000)
        }
    }
}
