import XCTest

extension AppTestCase {
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
        // A late "Save Password?" (iOS 26.5, ~10 s after the password went)
        // is audited as part of the screen (#846's run). Put it away, look again.
        if !(found.pinned + found.unpinned).isEmpty && declineSavingPassword() {
            found = try auditIssues(types)
        }
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
}
