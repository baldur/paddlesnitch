import XCTest

extension AppTestCase {
    /// How far the page must move up (down if negative) for `target` to be
    /// readable, with a little room. A fixed swipe flung the page past a
    /// target at the largest text size, and back, for all ten tries (CI).
    func distanceToReadable(_ target: XCUIElement) -> CGFloat {
        let area = readableArea
        let frame = target.frame
        guard frame.height <= area.height else { return frame.minY - area.minY - 16 }
        let room = min(16, (area.height - frame.height) / 2)
        if frame.minY < area.minY { return frame.minY - area.minY - room }
        return max(0, frame.maxY - area.maxY + room)
    }

    /// Drags the page by `distance` and holds, so it doesn't fling on. From
    /// the right margin, inside the readable area (see `swipe(up:)`).
    func scroll(by distance: CGFloat) {
        let area = readableArea
        let window = app.windows.firstMatch
        let reach = max(0, area.height - 40)
        // Too little room to drag clear of a tap, or nothing to measure (out
        // only sideways): the plain swipe.
        guard reach >= 30, distance != 0 else {
            swipe(up: distance >= 0)
            return
        }
        // A drag of a few points counts as a tap (see `nudgePage()`).
        let move = max(-reach, min(reach, abs(distance) < 30 ? (distance < 0 ? -30 : 30) : distance))
        let fromY = move > 0 ? area.maxY - 20 : area.minY + 20
        func point(_ y: CGFloat) -> XCUICoordinate {
            window.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: window.frame.width * 0.98, dy: y - window.frame.minY))
        }
        point(fromY).press(
            forDuration: 0.05, thenDragTo: point(fromY - move), withVelocity: .default, thenHoldForDuration: 0.3)
    }
}
