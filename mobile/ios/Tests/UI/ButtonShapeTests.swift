import XCTest

/// #793: buttons are drawn with a small corner radius (the token's
/// `rounded-control`, 6 pt), not as pills. iOS 26 draws bordered buttons as
/// capsules unless the app says otherwise. Read from the pixels: 6 pt along
/// the top edge is already the fill for any radius up to about 11 pt, where
/// a pill's (half the button's height) is still background; 1 pt in from
/// the corner is background, so it isn't square either. The exact radius
/// is the token's (the PaddleKit `ButtonShapeTests`).
///
/// On iOS 17 the system's own shape is already a small rounded rectangle,
/// so these can't fail there: the newest-iOS run is the one that counts.
final class ButtonShapeTests: AppTestCase {
    func testAButtonOnPaddlesHasControlCorners() {
        let button = app.buttons["sample-notice-action"]
        XCTAssertTrue(button.appears(timeout: 10))
        assertControlCorners(button)
    }

    /// The setting reaches sheets too.
    func testAButtonInTheSignInSheetHasControlCorners() {
        app.buttons["sample-notice-action"].tap()
        let button = app.buttons["sign-in-submit"]
        XCTAssertTrue(button.appears(timeout: 10))
        // Read once the frame stops changing. Before this wait, one local
        // run read the screenshot from the wrong place while the sheet
        // was coming up; XCTest's own wait for an idle app didn't cover it.
        var last = CGRect.null
        XCTAssertTrue(
            poll(timeout: 5) {
                defer { last = button.frame }
                return button.frame == last
            }, "the sheet settles")
        assertControlCorners(button)
    }

    /// The record screen is a full-screen cover, which also doesn't inherit
    /// the window's setting.
    func testAButtonOnTheRecordScreenHasControlCorners() {
        signInAndWait()
        openRecord()
        let button = app.buttons["record-start"]
        XCTAssertTrue(button.appears(timeout: 10))
        assertControlCorners(button)
    }

    private func assertControlCorners(_ button: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let shot = button.screenshot().image
        guard let pixels = Pixels(shot) else { return XCTFail("no pixels", file: file, line: line) }
        let fill = pixels.at(x: shot.size.width / 2, y: 3)
        let edge = pixels.at(x: 6, y: 1.5)
        let corner = pixels.at(x: 1, y: 1)
        XCTAssertTrue(edge.near(fill), "6 pt along the top is the fill: \(edge) vs \(fill)", file: file, line: line)
        XCTAssertFalse(corner.near(fill), "the corner is cut: \(corner) vs \(fill)", file: file, line: line)
    }
}
