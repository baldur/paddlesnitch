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
            guard let frame = keyboard.frameIfThere, exists, value(forKey: "hasKeyboardFocus") as? Bool ?? false
            else { return false }
            defer { last = frame }
            return frame == last
        }
    }

    /// Its frame, or nil if it isn't there. Reading `frame` straight after
    /// `exists` fails the test when it goes in between ("Failed to get
    /// matching snapshot: No matches found … Keyboard", CI on #808 and #810):
    /// the keyboard comes and goes with "Save Password?" and Done. A snapshot
    /// read throws instead, which is nil here.
    var frameIfThere: CGRect? {
        try? snapshot().frame
    }

    /// Whether a tap would land on it, waiting up to `timeout`.
    func becomesHittable(timeout: TimeInterval) -> Bool {
        poll(timeout: timeout) { exists && isHittable }
    }

    /// Whether it's there and its frame stood still between two looks.
    func standsStill(timeout: TimeInterval) -> Bool {
        var last = CGRect.null
        return poll(timeout: timeout) {
            let frame = frameIfThere ?? .null
            defer { last = frame }
            return !frame.isNull && frame == last
        }
    }
}

extension AppTestCase {
    /// Taps Safari's own close button ("Done" up to iOS 26, "Close" on 27)
    /// once it's hittable and has stopped moving; false if it never does.
    /// Not ours: the changed-Terms sheet has a "Close" too (`terms-close`),
    /// the Paddles notice another (`add-notice-close`), the keyboard a "Done". Still: a tap while Safari slides up is
    /// dropped, which looks just like Done closing nothing (#878). One
    /// query, not elements by index: those fail the test when Safari's views
    /// change as the page loads. A tap at the button's middle, as a finger:
    /// XCUITest's tap on the element did nothing on Safari presented by
    /// UIKit (26.5, twice, 3 s apart), and a tap at its middle closed it.
    @discardableResult
    func tapSafariCloseWhenStill(timeout: TimeInterval = 10) -> Bool {
        let button = app.buttons.matching(
            NSPredicate(
                format:
                    "label IN {'Done', 'Close'} AND NOT (identifier IN {'terms-close', 'keyboard-done', 'add-notice-close'})"
            )
        ).firstMatch
        var last = CGRect.null
        let still = poll(timeout: timeout) {
            let frame = button.frameIfThere ?? .null
            defer { last = frame }
            return !frame.isNull && frame == last && button.isHittable
        }
        guard still else { return false }
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: last.midX, dy: last.midY)).tap()
        return true
    }

    func dismissKeyboard() {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        let done = app.buttons["keyboard-done"].firstMatch
        // The code step's Done comes a moment after its keyboard; without
        // a wait, the drag tried instead left that keyboard up.
        let doneComing = app.textFields["code-field"].exists
        for _ in 0..<3 {
            // Tapped where it was: Done goes with the keyboard, and a tap on
            // a button that went between the look and the tap fails the test
            // ("no matches found … keyboard-done", CI on #834).
            var place: CGRect?
            if poll(
                timeout: doneComing ? 2 : 0,
                {
                    place = done.frameIfThere; return place != nil
                }), let place
            {
                app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: place.midX, dy: place.midY)).tap()
            } else {
                swipe(up: false)
            }
            if keyboard.disappears(timeout: 3) { return }
        }
        XCTFail("the keyboard went away")
    }

    /// Signed in from the sign-in sheet: the sheet has gone (it stays up when
    /// sign-in fails), and so has the samples notice. Both, not the notice
    /// alone: the check now looks at once, and a sheet might hide the notice.
    func signedIn() -> Bool {
        app.buttons["sign-in-submit"].disappears(timeout: 15) && element("sample-notice").disappears(timeout: 15)
    }

    /// iOS 26 asks "Save Password?" once a password is sent, for any secure
    /// field (an autofill type or none), covering the next screen's buttons.
    /// Not now, and whether it was there. iOS 27 doesn't ask there.
    @discardableResult
    func declineSavingPassword() -> Bool {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        // One short look at both, not a wait on each: on iOS 27 it never
        // comes, and every second here is paid in every such test.
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            for owner in [app, springboard] where owner.buttons["Not Now"].firstMatch.exists {
                owner.buttons["Not Now"].firstMatch.tap()
                // `make test-app` turns AutoFill off, so this should never
                // come: a warning the CI logs are counted by.
                print("\(#fileID):\(#line): warning: Save Password? came up in \(name); declined")
                return true
            }
            usleep(200_000)
        }
        return false
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
    /// the wrong screen (main's run 41112890501, SignInTests). It counts as
    /// switched when the tab is selected and its screen (titled as the tab)
    /// is up, and still is half a second later: the selection can show
    /// during the slide that then snaps back.
    func selectTab(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = tab(name)
        XCTAssertTrue(button.appears(timeout: 10), "no \(name) tab", file: file, line: line)
        let switched = { button.isSelected && self.app.navigationBars[name].exists }
        for _ in 0..<3 {
            button.tap()
            if poll(timeout: 2, switched) {
                Thread.sleep(forTimeInterval: 0.5)
                if switched() { return }
            }
        }
        XCTFail("the \(name) tab didn't stay selected", file: file, line: line)
    }

    /// Turns the sign-in sheet to Create account, tapping again if it didn't
    /// take. Tapped while the sheet is still sliding up, the tap lands where
    /// the segment was, not where it is, and the sheet stays on Sign in (PR
    /// #767's run 41225875032, iOS 17: the recording shows the segment move
    /// about 65 points under the tap).
    func showCreateAccount(file: StaticString = #filePath, line: UInt = #line) {
        let name = app.textFields["Display name"]
        for _ in 0..<3 {
            app.buttons["Create account"].firstMatch.tap()
            if name.appears(timeout: 3) { return }
        }
        XCTFail("the sheet didn't turn to Create account", file: file, line: line)
    }
}
