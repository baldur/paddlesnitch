import XCTest

/// The live motion trace and its line on the record screen (mobile/contract
/// README § Motion line), each status drawn from a block of the recorder
/// core's own fixtures (`trace_phone_flat`, `trace_phone_paddle`). The
/// simulator has no motion sensors, so the app shows the block it's handed
/// (`PADDLESNITCH_MOTION_TRACE`) in place of the core's. Run on an iPhone SE
/// simulator too: the smallest phone the app supports.
final class MotionTraceTests: AppTestCase {
    override func setUp() async throws {
        try await super.setUp()
        // Ask for location afresh in every test (this ends the app).
        app.resetAuthorizationStatus(for: .location)
    }

    func testEachStatusInTheAgreedWords() throws {
        var gpsTops: [String: CGFloat] = [:]
        for (status, words) in [
            ("starting", "Starting motion sensor"),
            ("still", "Motion sensor working, phone still"),
            ("motion", "Motion sensor working"),
            ("no_samples", "Couldn’t read the motion sensor. Stroke rate pauses until it’s back."),
        ] {
            let line = try showTrace(status)
            XCTAssertEqual(line.label, words, status)
            XCTAssertFalse(element("record-no-motion").exists, "\(status): the phone has motion sensors")
            let drawn = traceBox()
            XCTAssertEqual(drawn.box.height, Self.gap, accuracy: 1, "\(status): the trace keeps its 48 pt")
            if ["still", "motion"].contains(status) {
                XCTAssertGreaterThan(drawn.blue, 20, "\(status): a line is drawn")
                // The scale never goes under ±5 deg/s (the core's floor, #840):
                // a still phone draws almost flat, paddling fills the box.
                if status == "still" { XCTAssertLessThan(drawn.height, 12, "almost flat") }
                if status == "motion" { XCTAssertGreaterThan(drawn.height, 36, "the box's height") }
            } else {
                XCTAssertEqual(drawn.blue, 0, "\(status): nothing to draw")
            }
            let (red, muted) = lineColours(line)
            if status == "no_samples" {
                XCTAssertGreaterThan(red, 10, "red")
                XCTAssertEqual(muted, 0, "red, not muted")
            } else {
                XCTAssertEqual(red, 0, "\(status): muted, not red")
                XCTAssertGreaterThan(muted, 10, "\(status): muted")
            }
            gpsTops[status] = element("record-gps").frame.minY
            keep("Motion line, \(status)")
            try audit()
            app.resetAuthorizationStatus(for: .location)  // ends the app, asks again
        }
        // The box keeps its space: the GPS line doesn't move between
        // statuses whose words fit on one line.
        XCTAssertEqual(gpsTops["starting"], gpsTops["motion"])
        XCTAssertEqual(gpsTops["still"], gpsTops["motion"])
    }

    /// Order on the screen: time, stroke rate, the trace, its line, GPS.
    func testTheTraceSitsBetweenStrokeRateAndGPS() throws {
        let line = try showTrace("motion")
        let rate = element("record-stroke-rate").frame
        let gps = element("record-gps").frame
        XCTAssertLessThan(element("record-time").frame.maxY, rate.minY)
        XCTAssertEqual(line.frame.minY - rate.maxY, Self.gap, accuracy: 1, "the trace between")
        XCTAssertLessThan(line.frame.maxY, gps.minY)
    }
}

/// The record screen at the largest text size: the trace stays 48 pt, the
/// line wraps and nothing is clipped.
final class MotionTraceLargeTextTests: AppTestCase {
    override var launchArguments: [String] {
        ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    }

    override func setUp() async throws {
        try await super.setUp()
        app.resetAuthorizationStatus(for: .location)
    }

    func testTheMotionLineAtTheLargestTextSize() throws {
        for status in ["motion", "no_samples"] {
            let line = try showTrace(status)
            scrollAboveTheBar(line)
            // The frames only: the scroll can take part of the trace off the
            // top (MotionTraceTests checks the drawing).
            let gap = line.frame.minY - element("record-stroke-rate").frame.maxY
            XCTAssertEqual(gap, Self.gap, accuracy: 1, "\(status): still 48 pt")
            keep("Motion line at the largest text, \(status)")
            XCTAssertTrue(
                isReadable(line) && line.frame.maxY <= barTop,
                "\(status): the whole line on screen: \(line.frame) in \(readableArea), bar at \(barTop)")
            try audit(.textClipped)
            app.resetAuthorizationStatus(for: .location)  // ends the app, asks again
        }
    }

    /// Where the hold-to-stop bar starts: 16 pt over the hidden "Keep
    /// holding to stop." (8 pt over the button), which is in the same font
    /// as "Recording carries on." and as long. The bar draws over the page,
    /// but `isHittable` doesn't count it, and the hidden text has no element.
    private var barTop: CGFloat {
        let hint = text(containing: "Recording carries on.").frame.height
        return element("record-stop").frame.minY - 8 - hint - 16
    }

    /// At this size the hold-to-stop bar covers the foot of the screen, and
    /// a drag that starts on it doesn't scroll the page (`scroll(by:)` starts
    /// there). So drag from just above the bar, just as far as it takes to
    /// bring the whole of `target` above it (a drag of a few points counts
    /// as a tap).
    private func scrollAboveTheBar(_ target: XCUIElement) {
        let window = app.windows.firstMatch
        for _ in 0..<8 where target.frame.maxY > barTop {
            let fromY = barTop - 10
            let distance = min(max(target.frame.maxY - barTop + 8, 30), fromY - readableArea.minY - 10)
            let from = window.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: window.frame.width * 0.98, dy: fromY))
            from.press(
                forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -distance)),
                withVelocity: .slow, thenHoldForDuration: 0.3)
        }
    }
}

extension AppTestCase {
    /// From the stroke rate to the motion line: the screen's 24 pt between
    /// blocks, the trace's 48 pt and 6 pt to its line, at any text size.
    static var gap: CGFloat { 24 + 48 + 6 }

    /// Signs in and starts a recording that shows the core fixture's first
    /// trace with this status (the last for `no_samples`), and returns its line.
    func showTrace(_ status: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        app.launchEnvironment["PADDLESNITCH_MOTION_TRACE"] = try Self.traceBlock(status)
        app.launch()
        signInAndWait()
        openRecord()
        app.buttons["record-start"].tap()
        answerLocation("While Using")
        let motion = element("record-motion")
        XCTAssertTrue(motion.appears(timeout: 10), "the motion line", file: file, line: line)
        return motion
    }

    /// One block of `trace_phone_flat` or `trace_phone_paddle`'s trace.csv.
    static func traceBlock(_ status: String) throws -> String {
        let fixtures = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // UI
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // mobile
            .deletingLastPathComponent()  // repo
            .appending(path: "recorder-core/fixtures")
        var blocks: [String] = []
        for name in ["trace_phone_flat", "trace_phone_paddle"] {
            let text = try String(contentsOf: fixtures.appending(path: "\(name)/trace.csv"), encoding: .utf8)
            blocks += text.components(separatedBy: "trace,").dropFirst().map { "trace," + $0 }
        }
        let matching = blocks.filter { $0.hasPrefix("trace,\(status),") }
        guard let block = status == "no_samples" ? matching.last : matching.first else {
            throw NoTrace(status: status)  // fails: never a skip
        }
        return block
    }

    /// The space between the stroke rate and the motion line, how many
    /// points in it (one a point) are the trace's blue, and how tall the
    /// blue is.
    func traceBox() -> DrawnTrace {
        let shot = app.screenshot().image
        let top = element("record-stroke-rate").frame.maxY
        let bottom = element("record-motion").frame.minY
        let box = CGRect(x: 0, y: top, width: shot.size.width, height: bottom - top)
        guard let pixels = Pixels(shot) else { return DrawnTrace(box: box, blue: 0, height: 0) }
        let blue = Pixels.RGB(r: 0x38, g: 0xbd, b: 0xf8)
        var count = 0
        var rows: ClosedRange<CGFloat>?
        // Only what's on screen: a long scroll can take the stroke rate off the top.
        let seen = box.intersection(CGRect(origin: .zero, size: shot.size))
        for y in stride(from: seen.minY, to: seen.maxY, by: 1) {
            for x in stride(from: seen.minX, to: seen.maxX, by: 1) where pixels.at(x: x, y: y).near(blue) {
                count += 1
                rows = rows.map { min($0.lowerBound, y)...max($0.upperBound, y) } ?? y...y
            }
        }
        return DrawnTrace(box: box, blue: count, height: rows.map { $0.upperBound - $0.lowerBound } ?? 0)
    }

    /// Points in the line's text that are red (#f87171) and muted (#94a3b8).
    func lineColours(_ line: XCUIElement) -> (red: Int, muted: Int) {
        let shot = line.screenshot().image
        guard let pixels = Pixels(shot) else { return (0, 0) }
        let red = Pixels.RGB(r: 0xf8, g: 0x71, b: 0x71)
        let muted = Pixels.RGB(r: 0x94, g: 0xa3, b: 0xb8)
        var counts = (red: 0, muted: 0)
        for y in stride(from: 0, to: shot.size.height, by: 0.5) {
            for x in stride(from: 0, to: shot.size.width, by: 0.5) {
                let colour = pixels.at(x: x, y: y)
                if colour.near(red, within: 30) { counts.red += 1 }
                if colour.near(muted, within: 30) { counts.muted += 1 }
            }
        }
        return counts
    }

    func keep(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}

/// The core's fixtures have no trace with this status.
struct NoTrace: Error {
    let status: String
}

/// What `traceBox()` read from the screen.
struct DrawnTrace {
    let box: CGRect
    let blue: Int
    let height: CGFloat
}
