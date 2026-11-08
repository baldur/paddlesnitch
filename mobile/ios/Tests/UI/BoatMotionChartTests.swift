import XCTest

/// The boat motion charts' drawing (mobile/contract/README.md, "Boat
/// motion"), read from their pixels: roll and pitch never differ by colour
/// alone (#855), and the legends sit in the band above the plot.
final class BoatMotionChartTests: AppTestCase {
    /// Roll and pitch never differ by colour alone (#855): the legend sits
    /// in its 34 pt band above the lines, and pitch is dashed in the chart
    /// and in its key, roll solid and thicker (1.8 pt to 1.2).
    func testStrokeShapeKeepsItsLegendAboveTheLinesAndDashesPitch() throws {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let chart = scrollTo("motion-excerpt")
        let shot = try XCTUnwrap(ChartShot(chart))
        keep(chart, "Stroke shape")
        // The keys, on the legend's centre line (y 17).
        let rollKey = try XCTUnwrap(shot.run(y: 17) { $0.near(Self.roll) }, "roll's key")
        let pitchKey = try XCTUnwrap(shot.run(y: 17) { $0.near(Self.pitch) }, "pitch's key")
        let rollRow = stride(from: rollKey.lowerBound, through: rollKey.upperBound, by: 0.5)
        XCTAssertTrue(rollRow.allSatisfy { shot.at($0, 17).near(Self.roll) }, "roll's key is solid")
        XCTAssertEqual(rollKey.upperBound - rollKey.lowerBound, 18, accuracy: 1.5, "roll's key is 18 pt")
        let pitchRow = stride(from: pitchKey.lowerBound, through: pitchKey.upperBound, by: 0.5)
        XCTAssertFalse(pitchRow.allSatisfy { shot.at($0, 17).near(Self.pitch) }, "pitch's key is dashed")
        XCTAssertGreaterThan(pitchKey.lowerBound, rollKey.upperBound, "roll, then pitch")
        let rollWidth = shot.thickness(of: Self.roll, x: rollKey.lowerBound + 9, around: 17)
        let pitchWidth = shot.thickness(of: Self.pitch, x: pitchKey.lowerBound + 1.5, around: 17)
        XCTAssertEqual(rollWidth, 1.8, accuracy: 0.3, "roll's key is 1.8 pt thick")
        XCTAssertEqual(pitchWidth, 1.2, accuracy: 0.3, "pitch's key is 1.2 pt thick")
        // The plot starts below the band: nothing in it left of the legend,
        // nor under the legend, and the tallest roll (9.04° of a 9.94°
        // bound) peaks about 9 pt below the band.
        var inBand = 0
        var top = shot.height
        for x in stride(from: CGFloat(44), to: shot.width - 14, by: 0.5) {
            let from: CGFloat = x < rollKey.lowerBound - 4 ? 0 : 24
            for y in stride(from: from, to: 60, by: 0.5) where Self.isLine(shot.at(x, y)) {
                if y < 34 { inBand += 1 }
                top = min(top, y)
            }
        }
        XCTAssertEqual(inBand, 0, "the lines stay below the legend band")
        XCTAssertTrue((36...46).contains(top), "the tallest roll peaks just below the band: y \(top)")
        // The pitch series itself is dashed, at full colour.
        let plot = CGRect(x: 44, y: 34, width: shot.width - 58, height: shot.height - 60)
        let pitch = shot.dashes(of: Self.pitch, within: 60, in: plot)
        XCTAssertGreaterThan(pitch.ink, 100, "pitch at full colour")
        XCTAssertGreaterThan(pitch.short, 0.7, "the pitch line is dashed")
    }

    /// Each band of "Through the session" is outlined at full colour over
    /// both fills (which alone are under 3:1), pitch's dashed; its legend
    /// squares are outlined the same way and centred in the band (y 12–22).
    func testThroughTheSessionOutlinesEachBandAtFullColour() throws {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let chart = scrollTo("motion-envelope")
        let shot = try XCTUnwrap(ChartShot(chart))
        keep(chart, "Through the session")
        let columns = stride(from: CGFloat(60), to: shot.width - 30, by: 9).map { $0 }
        let outlined = columns.filter { x in
            stride(from: CGFloat(34), to: shot.height - 26, by: 0.5).contains {
                shot.at(x, $0).near(Self.roll, within: 40)
            }
        }
        XCTAssertEqual(outlined.count, columns.count, "roll's outline crosses every column")
        let plot = CGRect(x: 44, y: 34, width: shot.width - 58, height: shot.height - 60)
        let pitch = shot.dashes(of: Self.pitch, within: 40, in: plot)
        XCTAssertGreaterThan(pitch.ink, 100, "pitch's outline at full colour")
        XCTAssertGreaterThan(pitch.short, 0.7, "pitch's outline is dashed")
        try checkSwatch(Self.roll, in: shot, dashed: false)
        try checkSwatch(Self.pitch, in: shot, dashed: true)
    }

    /// A legend square: filled at 0.8, outlined at full colour (dashed for
    /// pitch), from y 12 to 22.
    private func checkSwatch(_ colour: Pixels.RGB, in shot: ChartShot, dashed: Bool) throws {
        let fill = ChartShot.faded(colour, 0.8)
        func tinted(_ pixel: Pixels.RGB) -> Bool { pixel.near(colour, within: 40) || pixel.near(fill, within: 40) }
        let swatch = try XCTUnwrap(shot.run(y: 17, tinted), "a swatch for \(colour)")
        XCTAssertEqual(swatch.upperBound - swatch.lowerBound, 10, accuracy: 1.5, "a 10 pt square")
        let middle = (swatch.lowerBound + swatch.upperBound) / 2
        XCTAssertTrue(tinted(shot.at(middle, 12.2)) && tinted(shot.at(middle, 21.8)), "the square spans y 12–22")
        XCTAssertFalse(tinted(shot.at(middle, 10.5)) || tinted(shot.at(middle, 23.5)), "and no further")
        let edge = stride(from: swatch.lowerBound + 1, to: swatch.upperBound - 1, by: 0.25)
            .map { shot.at($0, 12.1).near(colour, within: 25) }
        if dashed {
            XCTAssertTrue(edge.contains(true) && edge.contains(false), "pitch's square has a dashed outline: \(edge)")
        } else {
            XCTAssertTrue(edge.allSatisfy { $0 }, "roll's square has a full-colour outline: \(edge)")
        }
    }

    /// Both roll/pitch legends: "pitch" ends at the plot's right edge, "roll"
    /// ends 8 pt before pitch's key, keys sit 6 pt (lines) or 4 pt (squares)
    /// before their words, and the words share an x on both charts.
    func testTheRollAndPitchWordsSitTheSameOnBothCharts() throws {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let session = try XCTUnwrap(ChartShot(scrollTo("motion-envelope")))
        let shape = try XCTUnwrap(ChartShot(scrollTo("motion-excerpt")))
        let sessionWords = session.legendWords(), shapeWords = shape.legendWords()
        guard sessionWords.count == 2, shapeWords.count == 2 else {
            return XCTFail("two words on each legend: \(sessionWords), \(shapeWords)")
        }
        for (one, other) in zip(sessionWords, shapeWords) {
            XCTAssertEqual(one.lowerBound, other.lowerBound, accuracy: 1, "the words share an x")
            XCTAssertEqual(one.upperBound, other.upperBound, accuracy: 1, "the words share an x")
        }
        XCTAssertEqual(sessionWords[1].upperBound, session.width - 14, accuracy: 1.5, "pitch ends at the edge")
        XCTAssertEqual(shapeWords[1].upperBound, shape.width - 14, accuracy: 1.5, "pitch ends at the edge")
        let rollKey = try XCTUnwrap(shape.run(y: 17) { $0.near(Self.roll) })
        let pitchKey = try XCTUnwrap(shape.run(y: 17) { $0.near(Self.pitch) })
        XCTAssertEqual(pitchKey.lowerBound, shapeWords[0].upperBound + 8, accuracy: 2, "8 pt after roll")
        XCTAssertEqual(pitchKey.upperBound + 6, shapeWords[1].lowerBound, accuracy: 2, "6 pt before pitch")
        XCTAssertEqual(rollKey.upperBound + 6, shapeWords[0].lowerBound, accuracy: 2, "6 pt before roll")
        for (colour, word) in [(Self.roll, sessionWords[0]), (Self.pitch, sessionWords[1])] {
            let fill = ChartShot.faded(colour, 0.8)
            let swatch = try XCTUnwrap(session.run(y: 17) { $0.near(colour, within: 40) || $0.near(fill, within: 40) })
            XCTAssertEqual(swatch.upperBound + 4, word.lowerBound, accuracy: 2, "a square 4 pt before its word")
        }
    }

    /// The histogram's "mirrored" key is its line at full colour, as on the
    /// website.
    func testTheMirroredKeyIsAtFullColour() throws {
        openMotion("pdl-river")
        XCTAssertTrue(text(containing: "SIDE-TO-SIDE ROLL").appears(timeout: 10))
        let shot = try XCTUnwrap(ChartShot(scrollTo("motion-histogram")))
        let red = Pixels.RGB(r: 0xf8, g: 0x71, b: 0x71)
        XCTAssertNotNil(shot.run(y: 17, from: 44 + 70, to: 44 + 88) { $0.near(red, within: 40) }, "full red")
    }

    private func keep(_ chart: XCUIElement, _ name: String) {
        let shot = XCTAttachment(screenshot: chart.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// `split` and `green`, the roll and pitch colours.
    private static let roll = Pixels.RGB(r: 0xa7, g: 0x8b, b: 0xfa)
    private static let pitch = Pixels.RGB(r: 0x22, g: 0xc5, b: 0x5e)

    private static func isLine(_ pixel: Pixels.RGB) -> Bool { pixel.near(roll) || pixel.near(pitch) }
}

extension AppTestCase {
    /// Signs in and opens a paddle's Boat motion screen.
    func openMotion(_ paddle: String) {
        signInAndWait()
        open(paddle)
        let button = element("open-motion")
        XCTAssertTrue(button.appears(timeout: 10))
        button.tap()
    }
}
