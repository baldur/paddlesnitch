import XCTest

/// The native Account screen (mobile-apps.md, C5), against the sample server.
final class AccountTests: AppTestCase {
    private func openAccount() {
        tab("You").tap()
        let row = app.buttons["Account"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(element("account-terms").waitForExistence(timeout: 10))
    }

    func testTheAccountShowsTheTermsAreAccepted() {
        signInAndWait()
        openAccount()
        XCTAssertTrue(text(containing: "You accepted the Terms of Service on").exists)
        XCTAssertFalse(app.buttons["Accept the Terms"].exists)
    }

    func testChangedTermsAreAcceptedFromTheList() {
        signInAndWait(email: "sam@example.com")
        let accept = app.buttons["terms-notice-action"]
        XCTAssertTrue(accept.waitForExistence(timeout: 10))
        accept.tap()
        XCTAssertTrue(app.buttons["Read the Terms"].waitForExistence(timeout: 10), "can read them first")
        XCTAssertTrue(app.buttons["Read the Privacy Policy"].exists)
        let acceptButton = app.buttons["Accept the Terms"]
        XCTAssertFalse(acceptButton.isEnabled, "not until you agree, as on the website")
        app.switches["terms-agree"].firstMatch.switches.firstMatch.tap()
        XCTAssertTrue(acceptButton.isEnabled)
        acceptButton.tap()
        XCTAssertTrue(element("terms-notice").waitForNonExistence(timeout: 10), "the notice goes")
    }

    func testDownloadingYourDataOffersTheFile() {
        signInAndWait()
        openAccount()
        app.buttons["Download my data"].tap()
        // The share sheet, with the file: Save to Files, AirDrop, Mail…
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 15))
    }

    func testDeletingTheAccountNeedsDeleteTypedThenSaysItIsGone() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        let forGood = app.buttons["confirm-delete-account"].firstMatch
        XCTAssertTrue(forGood.waitForExistence(timeout: 10), "asks before deleting")
        XCTAssertFalse(forGood.isEnabled, "not until DELETE is typed, as on the website")
        let field = app.textFields["confirm-delete-text"]
        field.tap()
        field.typeText("DELETE")
        XCTAssertTrue(forGood.isEnabled)
        forGood.tap()
        XCTAssertTrue(element("account-deleted").waitForExistence(timeout: 10), "You says it's gone")
        tab("Paddles").tap()
        XCTAssertTrue(element("sample-notice").waitForExistence(timeout: 10), "signed out")
    }

    func testCancellingTheDeleteKeepsTheAccount() {
        signInAndWait()
        openAccount()
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(app.buttons["confirm-delete-account"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(app.buttons["confirm-delete-account"].firstMatch.waitForNonExistence(timeout: 5))
        tab("Paddles").tap()
        XCTAssertFalse(element("sample-notice").exists, "still signed in")
    }

    func testTheAccountPassesTheAccessibilityAudit() throws {
        signInAndWait()
        openAccount()
        try audit()
    }
}
