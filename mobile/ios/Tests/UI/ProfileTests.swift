import XCTest

/// Your details and public profile on the Account screen, against the
/// sample server (handle "river-pat"; "taken-handle" is someone else's).
final class ProfileTests: AppTestCase {
    func testTheAccountShowsYourDetailsAndPublicProfile() {
        signInAndWait()
        openAccount()
        XCTAssertTrue(text(containing: "Display name").appears(timeout: 10))
        XCTAssertTrue(app.buttons["Make profile private"].appears(timeout: 10))
        XCTAssertTrue(app.buttons["View my profile"].exists)
        XCTAssertEqual(app.textFields["profile-handle"].value as? String, "river-pat")
        XCTAssertFalse(app.textFields["contact-email"].exists, "a real email needs no contact email")
    }

    func testMakingTheProfilePrivate() {
        signInAndWait()
        openAccount()
        let toggle = app.buttons["Make profile private"]
        XCTAssertTrue(toggle.appears(timeout: 10))
        toggle.tap()
        XCTAssertTrue(app.buttons["Make profile public"].appears(timeout: 10))
        XCTAssertTrue(app.buttons["Preview my profile"].exists)
    }

    func testChangingTheHandleSaysSaved() {
        signInAndWait()
        openAccount()
        let field = scrollToElement(app.textFields["profile-handle"])
        replace(field, with: "pat-on-the-thames")
        scrollToElement(app.buttons["profile-handle-save"]).tap()
        XCTAssertEqual(scrollToElement(element("profile-handle-message")).label, "Saved.")
    }

    func testATakenHandleSaysWhy() {
        signInAndWait()
        openAccount()
        replace(scrollToElement(app.textFields["profile-handle"]), with: "taken-handle")
        scrollToElement(app.buttons["profile-handle-save"]).tap()
        XCTAssertEqual(scrollToElement(element("profile-handle-message")).label, "That handle is already taken.")
    }

    func testAStravaAccountIsAskedForAContactEmail() {
        signInWithStrava()
        openAccount()
        let field = app.textFields["contact-email"]
        XCTAssertTrue(field.appears(timeout: 10), "Strava doesn't share the email")
        type("me@example.com", into: field)
        app.buttons["contact-email-save"].tap()
        XCTAssertEqual(element("contact-email-message").label, "Saved.")
        XCTAssertTrue(app.buttons["Update"].exists)
    }

    /// A Strava account's sign-in email is a placeholder: signing in again
    /// to delete goes straight to Strava, then back to deleting.
    func testAStravaAccountSignsInAgainWithStravaToDelete() {
        signInWithStrava()
        app.terminate()
        app.launchArguments = ["-SampleServer", "-StaleSignIn", "-StravaAccount"]
        app.launch()
        openAccount()
        XCTAssertTrue(app.textFields["contact-email"].appears(timeout: 10), "the placeholder is known")
        scrollToElement(app.buttons["Delete my account"]).tap()
        XCTAssertTrue(element("delete-needs-sign-in").appears(timeout: 10))
        app.buttons["Sign in again"].tap()
        XCTAssertTrue(app.textFields["confirm-delete-text"].appears(timeout: 20), "straight back to deleting")
    }

    func testTheProfilePassesTheAccessibilityAudit() throws {
        signInAndWait()
        openAccount()
        XCTAssertTrue(app.buttons["Make profile private"].appears(timeout: 10))
        try audit()
    }

    private func signInWithStrava() {
        let notice = app.buttons["sample-notice-action"]
        XCTAssertTrue(notice.appears(timeout: 10))
        notice.tap()
        let strava = app.buttons["strava-sign-in"]
        XCTAssertTrue(strava.appears(timeout: 10))
        if !strava.isHittable { app.swipeUp() }
        strava.tap()
        XCTAssertTrue(signedIn(), "signed in")
    }

    private func replace(_ field: XCUIElement, with text: String) {
        let old = (field.value as? String) ?? ""
        type(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2) + text, into: field)
    }
}
