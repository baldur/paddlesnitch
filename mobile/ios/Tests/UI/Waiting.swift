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
