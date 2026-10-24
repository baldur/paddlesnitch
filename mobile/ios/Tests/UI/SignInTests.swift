import XCTest

/// Signing in, out and up, against the sample server.
final class SignInTests: AppTestCase {
    func testSigningInShowsYourPaddles() {
        signInAndWait()
        XCTAssertTrue(scrollTo("paddle-pdl-river").exists)
    }

    func testAWrongPasswordShowsTheServersWords() {
        signIn(password: "wrong")
        XCTAssertTrue(text(containing: "That email and password don’t match.").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["sign-in-submit"].exists, "still on the form")
    }

    func testYouStaySignedInAfterTheAppIsRelaunched() {
        signInAndWait()
        app.terminate()
        // Not -ResetAccount this time: the refresh token is in the Keychain.
        app.launchArguments = ["-SampleServer"]
        app.launch()
        tab("You").tap()
        XCTAssertTrue(element("signed-in-as").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Pat").exists)
        XCTAssertTrue(app.buttons["Account settings"].exists)
    }

    func testSigningOutGoesBackToTheSamples() {
        signInAndWait()
        tab("You").tap()
        app.buttons["Sign out"].firstMatch.tap()
        let confirm = app.buttons["confirm-sign-out"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "asks before signing out")
        confirm.tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 10))
        tab("Paddles").tap()
        XCTAssertTrue(element("sample-notice").waitForExistence(timeout: 10))
    }

    func testAnAccountWithChangedTermsIsToldSo() {
        signInAndWait(email: "sam@example.com")
        XCTAssertTrue(element("terms-notice").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "The Terms of Service have changed").exists)
    }

    func testCreatingAnAccountNeedsTheTermsTicked() {
        app.buttons["sample-notice-action"].tap()
        app.buttons["Create account"].firstMatch.tap()
        let name = app.textFields["Display name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        fill(email: "new@example.com", password: "Secret123")
        name.tap()
        name.typeText("New")
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(text(containing: "You must agree to the Terms of Service").waitForExistence(timeout: 10))
        element("terms-checkbox").tap()
        app.buttons["sign-in-submit"].tap()
        XCTAssertTrue(element("sample-notice").waitForNonExistence(timeout: 15), "signed up and in")
    }

    func testTheSignInSheetPassesTheAccessibilityAudit() throws {
        app.buttons["sample-notice-action"].tap()
        XCTAssertTrue(app.textFields["Email"].waitForExistence(timeout: 10))
        try audit()
        app.buttons["Create account"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Display name"].waitForExistence(timeout: 10))
        try audit()
    }

    func testYouSignedInPassesTheAccessibilityAudit() throws {
        signInAndWait()
        tab("You").tap()
        XCTAssertTrue(element("signed-in-as").waitForExistence(timeout: 10))
        try audit()
    }
}
