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

    /// Read once two screenshots in a row agree: a sheet or the record
    /// screen still sliding up showed the page behind the button (iOS 17 on
    /// CI, #834), and the button's frame doesn't change while it slides.
    private func assertControlCorners(_ button: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        var last: [Pixels.RGB]?
        var reading: [Pixels.RGB] = []
        let settled = poll(timeout: 10) {
            let shot = button.screenshot().image
            guard let pixels = Pixels(shot) else { return false }
            // The fill, 6 pt along the top edge, and 1 pt in from the corner.
            reading = [
                pixels.at(x: shot.size.width / 2, y: 3), pixels.at(x: 6, y: 1.5), pixels.at(x: 1, y: 1),
            ]
            defer { last = reading }
            return reading == last
        }
        XCTAssertTrue(settled, "the screen settles", file: file, line: line)
        let (fill, edge, corner) = (reading[0], reading[1], reading[2])
        XCTAssertTrue(edge.near(fill), "6 pt along the top is the fill: \(edge) vs \(fill)", file: file, line: line)
        XCTAssertFalse(corner.near(fill), "the corner is cut: \(corner) vs \(fill)", file: file, line: line)
    }
}

/// An image's pixels, read in points.
private struct Pixels {
    struct RGB: CustomStringConvertible, Equatable {
        let r: Int, g: Int, b: Int
        func near(_ other: RGB) -> Bool { abs(r - other.r) + abs(g - other.g) + abs(b - other.b) < 60 }
        var description: String { "(\(r), \(g), \(b))" }
    }

    let data: [UInt8]
    let width: Int
    let scale: CGFloat

    init?(_ image: UIImage) {
        guard let cg = image.cgImage else { return nil }
        width = cg.width
        scale = CGFloat(cg.width) / image.size.width
        var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                    bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
            return true
        }
        guard drawn else { return nil }
        data = bytes
    }

    func at(x: CGFloat, y: CGFloat) -> RGB {
        let i = (Int(y * scale) * width + Int(x * scale)) * 4
        return RGB(r: Int(data[i]), g: Int(data[i + 1]), b: Int(data[i + 2]))
    }
}
