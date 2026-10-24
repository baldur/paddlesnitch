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

    /// Lists create rows as they scroll into view, so swipe until it's there.
    @discardableResult
    func scrollTo(_ identifier: String) -> XCUIElement {
        let target = element(identifier)
        _ = app.collectionViews.firstMatch.waitForExistence(timeout: 10)
        var swipes = 0
        while !(target.exists && target.isHittable) && swipes < 8 {
            app.swipeUp()
            swipes += 1
        }
        return target
    }

    func open(_ paddle: String) {
        let row = scrollTo("paddle-\(paddle)")
        XCTAssertTrue(row.isHittable, "\(paddle) isn't on screen")
        row.tap()
    }

    /// Apple's accessibility audit, reporting every issue on the screen with
    /// the element it's about, not only the first.
    ///
    /// The Dynamic Type check is left to `LargeTextTests`: the audit grows the
    /// text in place and flags whatever that pushes off the bottom of the
    /// screen, a different element each run. LargeTextTests launches at the
    /// largest size and checks every screen for clipped text instead.
    func audit(
        _ types: XCUIAccessibilityAuditType = XCUIAccessibilityAuditType.all.subtracting(.dynamicType),
        file: StaticString = #filePath, line: UInt = #line
    ) throws {
        var issues: [String] = []
        try app.performAccessibilityAudit(for: types) { issue in
            let element = issue.element.map { "\($0.elementType) \"\($0.label)\"" } ?? "screen"
            issues.append("\(issue.compactDescription): \(element)")
            // Contrast issues keep Xcode's screenshots, so an unnamed one can be found.
            return issue.auditType != .contrast
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
