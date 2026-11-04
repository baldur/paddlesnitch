import XCTest

/// Launches the app on the bundled sample paddles (mobile/contract/fixtures/api)
/// and holds the helpers every UI test uses.
@MainActor
class AppTestCase: XCTestCase {
    let app = XCUIApplication()

    /// Extra launch arguments, e.g. a text size.
    var launchArguments: [String] { [] }

    /// Every test talks to the sample server (the contract's fixtures, no
    /// network) and starts signed out.
    override func setUp() async throws {
        continueAfterFailure = false
        // No logging in the app: every look a test takes logs there (XCTest's
        // side), and at full speed the system quarantined the app's logging,
        // which crashes XCTest in the app on iOS 17 ("not running", "Lost
        // connection"). Every launch below keeps this; tests change arguments.
        app.launchEnvironment["OS_ACTIVITY_MODE"] = "disable"
        app.launchArguments += ["-SampleServer", "-ResetAccount"] + launchArguments
        launchRetryingOnce { app.launch() }  // Launching.swift
    }

    /// Opens the sign-in sheet from the Paddles notice and signs in.
    func signIn(email: String = "pat@example.com", password: String = "Password123") {
        let button = app.buttons["sample-notice-action"]
        XCTAssertTrue(button.appears(timeout: 10))
        button.tap()
        fill(email: email, password: password)
        app.buttons["sign-in-submit"].tap()
    }

    /// Signs in and waits until the samples have made way for the account's
    /// own paddles.
    func signInAndWait(email: String = "pat@example.com") {
        signIn(email: email)
        XCTAssertTrue(signedIn(), "still showing the samples")
        XCTAssertTrue(element("logbook").appears(timeout: 10))
    }

    func fill(email: String, password: String) {
        let emailField = app.textFields["Email"]
        XCTAssertTrue(emailField.appears(timeout: 10))
        type(email, into: emailField)
        type(password, into: app.secureTextFields["Password"])
    }

    /// Taps the field and types once it has the keyboard. A tap while the
    /// keyboard is still moving (or the Passwords bar is) can leave it
    /// without focus, and typing then fails ("Neither element nor any
    /// descendant has keyboard focus", seen on CI).
    func type(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.appears(timeout: 10))
        // A field that took the keyboard itself (the code step's) needs no
        // tap, and one mid-animation can't take it ("not hittable"). Only
        // wait for that when a keyboard is up: otherwise it's 2 s for nothing
        // on every field, and the CI run hit its timeout.
        let focusedAlready = app.keyboards.firstMatch.exists && field.waitForKeyboardFocus(timeout: 2)
        if !focusedAlready {
            for _ in 0..<5 {
                scrollToElement(field).tap()
                if field.waitForKeyboardFocus(timeout: 2) { break }
            }
        }
        field.typeText(text)
    }

    /// Types into a field that takes the keyboard by itself (the code step's):
    /// waits for that, however late it comes (after "Save Password?" closes,
    /// iOS gives the keyboard back), and never taps it. Tapping a field while
    /// it takes the keyboard fails as "not hittable" on a slow simulator.
    func typeWhenFocused(_ text: String, into field: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(field.appears(timeout: 10))
        if !field.waitForKeyboardFocus(timeout: 5) {
            // It didn't come back by itself: tap, and wait again, or the
            // keyboard is still rising when the code is typed and it's lost.
            // "Save Password?" can come late, after the first look for it,
            // and cover the field: look again, then wait until a tap lands.
            XCTAssertTrue(becomesClear(scrollToElement(field)), "nothing over the field")
            field.tap()
            XCTAssertTrue(field.waitForKeyboardFocus(timeout: 5), "the field has the keyboard")
        }
        field.typeText(text)
        // "Save Password?" can also come while the keys go in, and take them
        // (CI on #840: an empty field, then "Enter the 6-digit code"). So
        // read it back, and if it isn't all there: away with the prompt,
        // clear what's there and type it again.
        guard typedText(in: field) != text else { return }
        declineSavingPassword()
        if !field.waitForKeyboardFocus(timeout: 2) {
            XCTAssertTrue(becomesClear(field), "nothing over the field")
            field.tap()
            XCTAssertTrue(field.waitForKeyboardFocus(timeout: 5), "the field has the keyboard")
        }
        // Nothing to delete when every key was lost (the flake's case).
        let stray = typedText(in: field).count
        if stray > 0 { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: stray)) }
        field.typeText(text)
        XCTAssertEqual(typedText(in: field), text, "typed", file: file, line: line)
    }

    /// Whether it becomes hittable, putting away a "Save Password?" that
    /// comes late, even during the wait: on #846's run it came after a look
    /// for it and covered the field for the rest of a single wait.
    func becomesClear(_ element: XCUIElement) -> Bool {
        for _ in 0..<3 {
            declineSavingPassword()
            if element.becomesHittable(timeout: 3) { return true }
        }
        return false
    }

    /// What's in a text field: an empty one reports its placeholder as its value.
    func typedText(in field: XCUIElement) -> String {
        let value = field.value as? String ?? ""
        return value == field.placeholderValue ? "" : value
    }

    /// Puts the keyboard away: the keyboard's Done (the code step's number
    /// pad has no return key), else a drag down the page.
    /// The code step's field takes the keyboard by itself, but after "Save
    /// Password?" iOS gives it back late. Wait for that, so a later
    /// `dismissKeyboard()` doesn't run before it comes and leave it over the
    /// buttons (CI: "Change email" not hittable).
    func waitForTheCodeKeyboard() {
        _ = app.textFields["code-field"].waitForKeyboardFocus(timeout: 5)
    }

    /// Taps once nothing covers it: the keyboard away, scrolled into view,
    /// and hittable; a keyboard that came back in between is put away again.
    /// So is a late "Save Password?": on iOS 26.5 it came ~10 s after the
    /// password was sent, after the code step's keyboard had gone (CI,
    /// "change-email" stayed covered).
    func tapWhenClear(_ target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<3 {
            dismissKeyboard()
            scrollToElement(target)
            if target.becomesHittable(timeout: 2) {
                target.tap()
                return
            }
            declineSavingPassword()
        }
        XCTFail("\(target) stayed covered", file: file, line: line)
    }

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// Any element whose label contains `fragment`: stats are combined into
    /// one accessibility element ("PACE, 2:45, /500, cruising"), not texts.
    func text(containing fragment: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    /// The part of the screen content can be read in: below the navigation
    /// bar, above the tab bar. iOS 17 draws an opaque tab bar and iOS 26+ a
    /// floating glass one; both cover rows.
    var readableArea: CGRect {
        let window = app.windows.firstMatch.frame
        let top = app.navigationBars.firstMatch.exists ? app.navigationBars.firstMatch.frame.maxY : window.minY
        var bottom = window.maxY
        // Only a tab bar that's in front: under a sheet it covers nothing.
        let tabBar = app.tabBars.firstMatch
        if tabBar.exists && tabBar.isHittable { bottom = min(bottom, tabBar.frame.minY) }
        // The keyboard covers what's under it too.
        if let keyboard = app.keyboards.firstMatch.frameIfThere { bottom = min(bottom, keyboard.minY) }
        let paddlesTab = tab("Paddles")
        if paddlesTab.exists && paddlesTab.isHittable { bottom = min(bottom, paddlesTab.frame.minY - 8) }
        return CGRect(x: window.minX, y: top, width: window.width, height: max(0, bottom - top))
    }

    /// Swipes until the element is wholly in the readable area. Lists create
    /// rows only as they scroll into view, and a row that's "hittable" can
    /// still be under the tab bar, where a tap lands on the bar.
    @discardableResult
    func scrollTo(_ identifier: String) -> XCUIElement {
        scrollToElement(element(identifier))
    }

    @discardableResult
    func scrollToElement(_ target: XCUIElement) -> XCUIElement {
        _ = app.windows.firstMatch.appears(timeout: 10)
        for _ in 0..<10 {
            if target.exists && isReadable(target) { break }
            guard target.exists else {
                swipe(up: true)
                continue
            }
            let before = target.frame
            scroll(by: distanceToReadable(target))
            // It didn't move: the page goes no further (a button at the foot
            // of a sheet at the largest text size). Nine more tries were 111
            // drags in one test, and 7x the looks (mobile/ios/CLAUDE.md).
            if target.exists && target.frame == before { break }
        }
        return target
    }

    /// A swipe from the side margin, outside every row (a swipe from the
    /// middle started on a tracker card at the largest text size and opened
    /// it), or, with the keyboard up, from the middle of what's above it (a
    /// swipe on the keyboard moves nothing).
    func swipe(up: Bool) {
        let window = app.windows.firstMatch
        guard app.keyboards.firstMatch.exists else {
            // The right margin: the left edge belongs to the back gesture,
            // and in the sign-in sheet a drag there scrolled nothing.
            let low = window.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.75))
            let high = window.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.3))
            let (from, to) = up ? (low, high) : (high, low)
            from.press(forDuration: 0.01, thenDragTo: to, withVelocity: .fast, thenHoldForDuration: 0)
            return
        }
        let area = readableArea
        func point(_ y: CGFloat) -> XCUICoordinate {
            window.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: area.midX - window.frame.minX, dy: y - window.frame.minY))
        }
        let from = point(area.midY + (up ? area.height / 4 : -area.height / 4))
        let to = point(area.midY + (up ? -area.height / 4 : area.height / 4))
        from.press(forDuration: 0.05, thenDragTo: to)
    }

    /// iOS 17 predicts that a navigation bar's large title (a one-line UIKit
    /// label) "may be clipped at larger Dynamic Type sizes", without naming
    /// the element. It's raised only on the two screens with large titles, and
    /// the same screens' content passes the real clipping check at the largest
    /// size (LargeTextTests). iOS 18+ doesn't raise it. Anything the audit pins
    /// on an element still fails.
    static func isIOS17LargeTitleWarning(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        issue.auditType == .textClipped && issue.element == nil
            && issue.detailedDescription.contains("may be clipped at larger Dynamic Type sizes")
            && ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 18
    }

    /// A text field never cuts its text off: it scrolls it. The audit still
    /// calls a filled one clipped (our font; zoomed screenshots show every
    /// letter), so that one report, on a text field only, is ignored.
    static func isTextFieldClipWarning(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        issue.auditType == .textClipped
            && [.textField, .secureTextField].contains(issue.element?.elementType ?? .any)
    }

    /// Wholly in the readable area, or, for an element taller than that area
    /// (a row at the largest text size), its top is in the area with room
    /// under it, so it fills the rest. (Its middle can't be on screen with its
    /// top once it's twice the area's height: a tracker card at the largest
    /// size. The window is wider than one swipe, so scrolling can't hop over it.)
    func isReadable(_ element: XCUIElement) -> Bool {
        let area = readableArea
        let frame = element.frame
        if frame.height <= area.height { return area.contains(frame) }
        return frame.minY >= area.minY && frame.minY <= area.maxY - 88
    }

    func open(_ paddle: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = element("paddle-\(paddle)")
        _ = app.windows.firstMatch.appears(timeout: 10)
        // Swipe until a good slice of the row (44 pt, a tap target) is in the
        // readable area, then tap in that slice: at the largest text size a
        // row can be taller than the screen, and its middle may be under a bar.
        for _ in 0..<10 {
            if row.exists, visibleSlice(of: row).height >= 44 { break }
            if row.exists && row.frame.minY < readableArea.minY { app.swipeDown() } else { app.swipeUp() }
        }
        // A swipe leaves the list gliding, and a tap on a moving list only
        // stops it. Wait for two looks in a row to agree. (#864's and
        // #870's misses were a dead spot in the row, since fixed.)
        var last = CGRect.null
        for _ in 0..<20 {
            guard row.exists, row.frame != last else { break }
            last = row.frame
        }
        let slice = visibleSlice(of: row)
        guard slice.height >= 44 else {
            XCTFail("\(paddle) isn't on screen to tap", file: file, line: line)
            return
        }
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: slice.midX - window.frame.minX, dy: slice.midY - window.frame.minY))
            .tap()
    }

    func visibleSlice(of element: XCUIElement) -> CGRect {
        element.exists ? element.frame.intersection(readableArea) : .null
    }

    /// You → Account, signed in.
    func openAccount() {
        selectTab("You")
        let row = app.buttons["Account"]
        XCTAssertTrue(row.appears(timeout: 10))
        row.tap()
        XCTAssertTrue(app.navigationBars["Account"].appears(timeout: 10))
        // The profile loads after the screen; wait for it, and for it to stop
        // moving, before anyone audits or taps.
        let loaded = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Make profile'")).firstMatch
        // At the largest text size it's below the fold, where a List hasn't
        // made its row yet: go and look, then come back to the top.
        let below = !loaded.appears(timeout: 3)
        if below { scrollToElement(loaded) }
        XCTAssertTrue(loaded.appears(timeout: 10), "the profile loaded")
        var last = CGRect.null
        for _ in 0..<20 where loaded.frame != last {
            last = loaded.frame
            usleep(150_000)
        }
        if below {
            // `exists` first: `isHittable` on a row not made yet spends ~2 s
            // looking for it.
            let top = app.staticTexts["Your details"].firstMatch
            for _ in 0..<8 where !(top.exists && top.isHittable) { app.swipeDown() }
        }
    }

    /// Tab items, wherever this iOS draws the tab bar.
    /// The tab bar's button, not a back button with the same label ("You"
    /// on Account). iOS 26's floating bar may not be a tab bar to XCTest, so
    /// then any button.
    func tab(_ name: String) -> XCUIElement {
        let label = NSPredicate(format: "label == %@", name)
        let inBar = app.tabBars.buttons.matching(label).firstMatch
        return inBar.exists ? inBar : app.buttons.matching(label).firstMatch
    }
}
