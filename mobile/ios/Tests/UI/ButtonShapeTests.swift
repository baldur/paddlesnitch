import XCTest

/// #793: buttons are drawn with the control radius (6 pt, the token's
/// `rounded-control`), not as pills. iOS 26 draws bordered buttons as
/// capsules unless the app says otherwise. Read from the pixels: 6 pt along
/// the top edge, a 6 pt corner is already filled, where a 44 pt pill's
/// corner (22 pt) is still background; 1 pt in from the corner is
/// background either way, so the button isn't square either.
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
        // Read once the sheet has stopped moving: mid-slide, the screenshot is
        // of what's under the button's place.
        var last = CGRect.null
        XCTAssertTrue(
            poll(timeout: 5) {
                defer { last = button.frame }
                return button.frame == last
            }, "the sheet settles")
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

/// An image's pixels, read in points.
private struct Pixels {
    struct RGB: CustomStringConvertible {
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
