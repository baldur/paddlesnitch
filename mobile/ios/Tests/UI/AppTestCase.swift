import XCTest

/// Launches the app on the bundled sample paddles (mobile/contract/fixtures/api)
/// and holds the helpers every UI test uses.
@MainActor
class AppTestCase: XCTestCase {
    let app = XCUIApplication()

    /// Extra launch arguments, e.g. a text size.
    var launchArguments: [String] { [] }

    override func setUp() async throws {
        continueAfterFailure = false
        app.launchArguments += launchArguments
        app.launch()
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
        if app.tabBars.firstMatch.exists { bottom = min(bottom, app.tabBars.firstMatch.frame.minY) }
        let paddlesTab = tab("Paddles")
        if paddlesTab.exists { bottom = min(bottom, paddlesTab.frame.minY - 8) }
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
        _ = app.windows.firstMatch.waitForExistence(timeout: 10)
        for _ in 0..<10 {
            if target.exists && isReadable(target) { break }
            if target.exists && target.frame.minY < readableArea.minY {
                app.swipeDown()
            } else {
                app.swipeUp()
            }
        }
        return target
    }

    /// Wholly in the readable area, or, for an element taller than that area
    /// (a row at the largest text size), its top and its middle are.
    func isReadable(_ element: XCUIElement) -> Bool {
        let area = readableArea
        let frame = element.frame
        if frame.height <= area.height { return area.contains(frame) }
        return frame.minY >= area.minY && area.contains(CGPoint(x: frame.midX, y: frame.midY))
    }

    func open(_ paddle: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = scrollTo("paddle-\(paddle)")
        XCTAssertTrue(isReadable(row), "\(paddle) isn't on screen to tap", file: file, line: line)
        row.tap()
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
    func audit(
        _ types: XCUIAccessibilityAuditType = XCUIAccessibilityAuditType.all.subtracting([.dynamicType, .contrast]),
        file: StaticString = #filePath, line: UInt = #line
    ) throws {
        var issues: [String] = []
        try app.performAccessibilityAudit(for: types) { issue in
            let element = issue.element.map { "\($0.elementType) \"\($0.label)\"" } ?? "screen"
            issues.append("\(issue.compactDescription): \(element)")
            // An issue the audit can't pin on an element keeps Xcode's
            // screenshots in the test results, so it can still be found.
            return issue.element != nil
        }
        if !issues.isEmpty {
            XCTFail("Accessibility audit:\n" + issues.joined(separator: "\n"), file: file, line: line)
        }
    }

    /// Tab items, wherever this iOS draws the tab bar.
    func tab(_ name: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
    }
}
