import XCTest

/// The native Account screen (mobile-apps.md, C5), against the sample server.
final class AccountTests: AppTestCase {
    func testTheAccountShowsTheTermsAreAccepted() {
        signInAndWait()
        openAccount()
        XCTAssertTrue(scrollToElement(text(containing: "You accepted the Terms of Service on")).exists)
        XCTAssertFalse(app.buttons["Accept the Terms"].exists)
    }

    func testChangedTermsAreAcceptedFromTheList() {
        signInAndWait(email: "sam@example.com")
        let accept = app.buttons["terms-notice-action"]
        XCTAssertTrue(accept.appears(timeout: 10))
        accept.tap()
        XCTAssertTrue(app.buttons["Read the Terms"].appears(timeout: 10), "can read them first")
        XCTAssertTrue(app.buttons["Read the Privacy Policy"].exists)
        let acceptButton = app.buttons["Accept the Terms"]
        XCTAssertFalse(acceptButton.isEnabled, "not until you agree, as on the website")
        app.switches["terms-agree"].firstMatch.switches.firstMatch.tap()
        XCTAssertTrue(acceptButton.isEnabled)
        acceptButton.tap()
        XCTAssertTrue(element("terms-notice").disappears(timeout: 10), "the notice goes")
    }

    func testDownloadingYourDataOffersTheFile() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["Download my data"]).tap()
        // The share sheet, with the file: Save to Files, AirDrop, Mail…
        XCTAssertTrue(app.otherElements["ActivityListView"].appears(timeout: 15))
    }

    func testDeletingTheAccountNeedsDeleteTypedThenSaysItIsGone() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        let forGood = app.buttons["confirm-delete-account"].firstMatch
        XCTAssertTrue(forGood.appears(timeout: 10), "asks before deleting")
        XCTAssertFalse(forGood.isEnabled, "not until DELETE is typed, as on the website")
        type("DELETE", into: app.textFields["confirm-delete-text"])
        XCTAssertTrue(forGood.isEnabled)
        forGood.tap()
        XCTAssertTrue(element("account-deleted").appears(timeout: 10), "You says it's gone")
        tab("Paddles").tap()
        XCTAssertTrue(element("sample-notice").appears(timeout: 10), "signed out")
    }

    /// Deleting needs a sign-in from the last 10 minutes: sign in again and
    /// come straight back to deleting (mobile/contract/README.md, Account).
    func testAnOldSignInSignsInAgainThenComesBackToDelete() {
        signInAndWait()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StaleSignIn"]
        app.launch()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").appears(timeout: 10))
        XCTAssertFalse(app.textFields["confirm-delete-text"].exists, "not asked to type DELETE in vain")
        app.buttons["Sign in again"].tap()

        let email = app.textFields["Email"]
        XCTAssertTrue(email.appears(timeout: 10))
        XCTAssertEqual(email.value as? String, "pat@example.com", "the email they were signed in with")
        let password = app.secureTextFields["Password"]
        password.tap()
        password.typeText("Password123")
        app.buttons["sign-in-submit"].tap()

        let field = app.textFields["confirm-delete-text"]
        XCTAssertTrue(field.appears(timeout: 15), "straight back to deleting")
        field.tap()
        field.typeText("DELETE")
        app.buttons["confirm-delete-account"].firstMatch.tap()
        XCTAssertTrue(element("account-deleted").appears(timeout: 10))
    }

    func testCancellingTheDeleteKeepsTheAccount() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(app.buttons["confirm-delete-account"].firstMatch.appears(timeout: 10))
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["confirm-delete-account"].firstMatch.disappears(timeout: 5))
        tab("Paddles").tap()
        XCTAssertFalse(element("sample-notice").exists, "still signed in")
    }

    func testTheAccountPassesTheAccessibilityAudit() throws {
        signInAndWait()
        openAccount()
        try audit()
    }
}
