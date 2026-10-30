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
        app.launch()
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
    func typeWhenFocused(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.appears(timeout: 10))
        if !field.waitForKeyboardFocus(timeout: 5) {
            // It didn't come back by itself: tap, and wait again, or the
            // keyboard is still rising when the code is typed and it's lost.
            // "Save Password?" can come late, after the first look for it,
            // and cover the field: look again, then wait until a tap lands.
            declineSavingPassword()
            XCTAssertTrue(scrollToElement(field).becomesHittable(timeout: 5), "nothing over the field")
            field.tap()
            XCTAssertTrue(field.waitForKeyboardFocus(timeout: 5), "the field has the keyboard")
        }
        field.typeText(text)
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

    func dismissKeyboard() {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        let done = app.buttons["keyboard-done"].firstMatch
        // The code step's Done comes a moment after its keyboard; without
        // a wait, the drag tried instead left that keyboard up.
        let doneComing = app.textFields["code-field"].exists
        for _ in 0..<3 {
            if done.becomesHittable(timeout: doneComing ? 2 : 0) { done.tap() } else { swipe(up: false) }
            if keyboard.disappears(timeout: 3) { return }
        }
        XCTFail("the keyboard went away")
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
        if app.keyboards.firstMatch.exists { bottom = min(bottom, app.keyboards.firstMatch.frame.minY) }
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

    /// Apple's accessibility audit, reporting every issue on the screen with
    /// the element it's about, not only the first.
    ///
    /// Two checks are done better elsewhere:
    /// - Dynamic Type: the audit grows the text in place and flags whatever
    ///   that pushes off screen, a different element each run. `LargeTextTests`
    ///   launches at the largest size and checks every screen for clipped text.
    /// - Contrast: iOS 26+ blurs what scrolls under its glass bars, and the
    ///   audit measures it anyway. `ContrastTests` (DesignSystem) checks every
    ///   colour pairing from the tokens instead.
    ///
    /// The audit isn't steady (mobile/ios/CLAUDE.md). An issue it can't pin on
    /// an element comes and goes, so it's asked up to three times with the
    /// page moved a little each time, and fails only if raised every time; a
    /// real clip ("NO GPS" cut to "N…") is layout that stays. A slow
    /// runner's timeout (code -56) is retried once.
    ///
    /// `unpinnedFails: false` keeps the screenshots of a report on no element
    /// but doesn't fail on it: for a long List at the largest text size,
    /// where rows half under a bar draw that report wherever the page stops
    /// (seen on every look, nothing clipped in any screenshot). Reports on an
    /// element still fail.
    func audit(
        _ types: XCUIAccessibilityAuditType = XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast]),
        unpinnedFails: Bool = true, file: StaticString = #filePath, line: UInt = #line
    ) throws {
        var found = try auditIssues(types)
        // A row half under a bar draws a report on no element, and it moves
        // with the page; a real clip ("NO GPS" → "N…") is layout and stays
        // through small moves. So: two more looks, the page moved a little
        // before each, and it fails only if all three report it. Not when
        // such a report can't fail anyway: those looks were ~40% of a
        // large-text test.
        for _ in 0..<2 where unpinnedFails && found.pinned.isEmpty && !found.unpinned.isEmpty {
            keepScreenshot("Audit issue on no element")
            nudgePage()
            found = try auditIssues(types)
        }
        let issues = found.pinned + (unpinnedFails ? found.unpinned : [])
        if !unpinnedFails && !found.unpinned.isEmpty { keepScreenshot("Audit issue on no element, not failed") }
        if !issues.isEmpty {
            keepScreenshot("Audit issues")
            XCTFail("Accessibility audit:\n" + issues.joined(separator: "\n"), file: file, line: line)
        }
    }

    private func auditIssues(_ types: XCUIAccessibilityAuditType) throws -> (pinned: [String], unpinned: [String]) {
        for attempt in 1...2 {
            var pinned: [String] = []
            var unpinned: [String] = []
            do {
                try app.performAccessibilityAudit(for: types) { issue in
                    if Self.isIOS17LargeTitleWarning(issue) || Self.isTextFieldClipWarning(issue) { return true }
                    if let element = issue.element {
                        pinned.append("\(issue.compactDescription): \(element.elementType) \"\(element.label)\"")
                    } else {
                        unpinned.append("\(issue.compactDescription): \(issue.detailedDescription) (no element)")
                    }
                    return true
                }
                return (pinned, unpinned)
            } catch let error as NSError where error.code == Self.auditTimedOut && attempt == 1 {
                continue
            }
        }
        return ([], [])
    }

    /// "Audit failed to complete in time", seen on slow CI runners.
    static let auditTimedOut = -56

    /// Moves a scrolling page a little, and must never tap: a drag of a few
    /// points counted as a tap and flipped "Make profile private" between
    /// looks. So a clear scroll (15% of the screen), from the left margin.
    private func nudgePage() {
        let window = app.windows.firstMatch
        guard window.exists else { return }
        let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.6))
        let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.45))
        from.press(forDuration: 0.01, thenDragTo: to, withVelocity: .default, thenHoldForDuration: 0.3)
    }

    private func keepScreenshot(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// You → Account, signed in.
    func openAccount() {
        tab("You").tap()
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
    func tab(_ name: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
    }
}
