package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.AnalysisPoint
import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.ApiJson
import java.io.File
import kotlin.math.PI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// What the paddle page shows, worked out from the contract's golden answers.
class PaddleDetailTest {
    private fun fixture(name: String) =
        PaddleDetail(ApiJson.decodeFromString(AnalysisSession.serializer(), File("../../contract/fixtures/api/$name").readText()))

    @Test
    fun aPaddleWithARouteShowsWhatTheWebsiteShows() {
        val d = fixture("paddles.get.json")
        assertEquals("TRACKER · K1", d.eyebrow?.uppercase())
        assertEquals(
            listOf(
                Stat("Time", "2:59"), Stat("Distance", "0.48 km"), Stat("Pace", "2:45", "/500, cruising"),
                Stat("Stroke rate", "64", "spm"), Stat("Per stroke", "2.9 m"),
                Stat("Wind", "11 km/h", "from the SW"), Stat("River", "48.2 m³/s", "at Reading"),
            ),
            d.stats,
        )
        assertEquals(listOf(EffortRow(1, "1:53", "1:06", "2:31", "64", "steady")), d.efforts)
        assertEquals(listOf("29 s at 1:23"), d.rests)
        assertEquals("a set of one isn't a repeat", emptyList<String>(), d.repeats)
        assertEquals("Headwind on the way back.", d.note)
        assertTrue(d.insight!!.startsWith("A 3-min paddle"))
        assertEquals("under 500 m has no splits", emptyList<SplitRow>(), d.splits)
        assertNull(d.noGpsMessage)
        assertTrue(d.route.isNotEmpty())
        assertEquals(PaddleDetail.bounds(fixturePoints()), d.bounds)
    }

    private fun fixturePoints() =
        ApiJson.decodeFromString(AnalysisSession.serializer(), File("../../contract/fixtures/api/paddles.get.json").readText()).result.points

    @Test
    fun aPaddleWithoutGpsHasNoMapAndSaysWhy() {
        val d = fixture("paddles.get.motion-only.json")
        assertEquals(
            listOf(Stat("Paddling", "0:19", "from the boat's motion"), Stat("Distance", "—", "no GPS"), Stat("Stroke rate", "64", "spm"), Stat("Strokes", "2,300", "about")),
            d.stats,
        )
        assertTrue(d.route.isEmpty())
        assertNull(d.bounds)
        assertTrue(d.noGpsMessage!!.startsWith("The GPS lost the sky 19 seconds after you set off"))
        assertEquals("2X", d.eyebrow!!.substringAfter(" · "))
    }

    @Test
    fun aStravaPaddleWithoutConditionsOrBoat() {
        val d = fixture("paddles.get.strava.json")
        assertEquals("Strava", d.eyebrow)
        assertTrue(d.stats.none { it.label == "Wind" || it.label == "River" })
        assertNull(d.note)
    }

    @Test
    fun anUnknownSourceAndBoatStillOpen() {
        val d = fixture("paddles.get.unknown-values.json")
        assertEquals("?", d.eyebrow)
    }

    @Test
    fun boundsAreTheRoutesCorners() {
        val pts = listOf(pt(0, 51.0, -1.0), pt(1, 51.2, -0.9), pt(2, 51.1, -1.1))
        assertEquals(Bounds(51.0, -1.1, 51.2, -0.9), PaddleDetail.bounds(pts))
        assertNull(PaddleDetail.bounds(emptyList()))
    }

    @Test
    fun theRouteIsRunsOfOneColourWithNoGaps() {
        val pts = (0 until 10).map { pt(it, 51.0 + it * 0.001, -1.0, speed = if (it < 5) 1.0 else 4.0) }
        val runs = PaddleDetail.runs(pts)
        val colours = ColourScale.colours(pts)
        assertEquals(listOf(colours[1], colours[5]), runs.map { it.colour })
        assertEquals("each run starts where the last ended", runs[0].coords.last(), runs[1].coords.first())
        assertEquals(pts.size + runs.size - 1, runs.sumOf { it.coords.size })
    }

    @Test
    fun splitsEvery500mWithTheLastPart() {
        // Due north at 5 m/s for 1,250 m; 60 spm for the first 100 s, then 70.
        val metresPerDegree = 6371000 * PI / 180
        val pts = (0..250).map { pt(it, 51.0 + it * 5 / metresPerDegree, -1.0, speed = 5.0, sr = if (it < 100) 60.0 else 70.0) }
        assertEquals(
            listOf(SplitRow("0.5", "1:40", "1:40", "60"), SplitRow("1.0", "3:20", "1:40", "70"), SplitRow("1.25", "4:10", "1:40", "70")),
            PaddleDetail.splits(pts),
        )
    }

    @Test
    fun aShortLastPartJoinsNoRow() {
        val metresPerDegree = 6371000 * PI / 180
        val pts = (0..110).map { pt(it, 51.0 + it * 5 / metresPerDegree, -1.0, speed = 5.0) }
        assertEquals(listOf(SplitRow("0.5", "1:40", "1:40", "—")), PaddleDetail.splits(pts))
    }

    @Test
    fun theColourRampMatchesTheWebsitesStops() {
        assertEquals(0x2563EB, ColourScale.ramp(0.0))
        assertEquals(0x06B6D4, ColourScale.ramp(0.4))
        assertEquals(0xEAB308, ColourScale.ramp(0.7))
        assertEquals(0xDC2626, ColourScale.ramp(1.0))
        assertEquals((22 shl 16) or (141 shl 8) or 224, ColourScale.ramp(0.2))
        assertEquals(0x2563EB, ColourScale.ramp(-3.0))
        assertEquals(0xDC2626, ColourScale.ramp(9.0))
    }

    @Test
    fun theScaleRunsFromTheTenthToTheNinetiethPercentile() {
        val pts = (1..10).map { pt(it, 51.0, -1.0, speed = it.toDouble()) }
        assertEquals(2.0 to 10.0, ColourScale.bounds(pts))
        assertNull(ColourScale.bounds(listOf(pt(0, 51.0, -1.0, speed = 3.0))))
        assertEquals(listOf(ColourScale.MISSING), ColourScale.colours(listOf(pt(0, 51.0, -1.0, speed = 3.0))))
    }

    private fun pt(t: Int, lat: Double, lng: Double, speed: Double = 3.0, sr: Double? = null) = AnalysisPoint(t.toDouble(), lat, lng, speed, sr, null)
}
