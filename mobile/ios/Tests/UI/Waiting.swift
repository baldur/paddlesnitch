import XCTest

/// Waits that look straight away, then back off to one look a second.
///
/// XCTest's own (`waitForExistence`, `waitForNonExistence`, an
/// `XCTNSPredicateExpectation`) first look a full second after they start,
/// even when the answer is already yes. With ~15 waits a test that was a
/// third of every UI test, and the newest-iOS job ran past its 70-minute
/// limit (mobile/ios/CLAUDE.md). SwiftLint's `xctest_waits` rule keeps them out.
///
/// Don't look more often than that: every look makes XCTest log inside the
/// app, and looking every 0.2 s logged so much that the system quarantined
/// the app's logging, which crashes XCTest in the app on iOS 17.
@MainActor
extension XCUIElement {
    /// Whether it exists, or comes within `timeout`.
    func appears(timeout: TimeInterval) -> Bool {
        poll(timeout: timeout) { exists }
    }

    /// Whether it's gone, or goes within `timeout`.
    func disappears(timeout: TimeInterval) -> Bool {
        poll(timeout: timeout) { !exists }
    }

    /// Whether this field has the keyboard, and the keyboard is up and
    /// still, waiting up to `timeout`. Focus alone isn't enough: after "Save
    /// Password?" the field has it before the keyboard is back, and the code
    /// typed then was lost (an empty field, "Enter the 6-digit code").
    func waitForKeyboardFocus(timeout: TimeInterval) -> Bool {
        let keyboard = XCUIApplication().keyboards.firstMatch
        var last = CGRect.null
        return poll(timeout: timeout) {
            // The keyboard first: while it's down that's one look, not three.
            guard keyboard.exists, exists, value(forKey: "hasKeyboardFocus") as? Bool ?? false else { return false }
            let frame = keyboard.frame
            defer { last = frame }
            return frame == last
        }
    }

    /// Whether a tap would land on it, waiting up to `timeout`.
    func becomesHittable(timeout: TimeInterval) -> Bool {
        poll(timeout: timeout) { exists && isHittable }
    }
}

extension AppTestCase {
    /// Signed in from the sign-in sheet: the sheet has gone (it stays up when
    /// sign-in fails), and so has the samples notice. Both, not the notice
    /// alone: the check now looks at once, and a sheet might hide the notice.
    func signedIn() -> Bool {
        app.buttons["sign-in-submit"].disappears(timeout: 15) && element("sample-notice").disappears(timeout: 15)
    }

    /// iOS 26 asks "Save Password?" once a password is sent, for any secure
    /// field (an autofill type or none), covering the next screen's buttons.
    /// Not now. iOS 27 doesn't ask there.
    func declineSavingPassword() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // One short look at both, not a wait on each: on iOS 27 it never
        // comes, and every second here is paid in every such test.
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            for owner in [app, springboard] where owner.buttons["Not Now"].firstMatch.exists {
                owner.buttons["Not Now"].firstMatch.tap()
                return
            }
            usleep(200_000)
        }
    }
}

/// True as soon as `condition` is; false if it still isn't after `timeout`.
/// Looks at once, then after 0.25 s, 0.5 s and every second after that.
@MainActor
func poll(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    var pause: TimeInterval = 0.25
    while !condition() {
        let left = end.timeIntervalSinceNow
        if left <= 0 { return false }
        Thread.sleep(forTimeInterval: min(pause, left))
        pause = min(pause * 2, 1)
    }
    return true
}

extension AppTestCase {
    /// Switches tab, tapping again if it didn't take. A tab tapped while the
    /// screens are still redrawing (just after signing out) slides towards
    /// the new tab on iOS 26 and snaps back, and a single tap then waits on
    /// the wrong screen (main's run 41112890501, SignInTests).
    func selectTab(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = tab(name)
        XCTAssertTrue(button.appears(timeout: 10), "no \(name) tab", file: file, line: line)
        for _ in 0..<3 {
            button.tap()
            if poll(timeout: 2, { button.isSelected }) { return }
        }
        XCTFail("the \(name) tab didn't stay selected", file: file, line: line)
    }
}
