package com.paddlesnitch.app.paddles

import com.paddlesnitch.app.api.AnalysisSession
import com.paddlesnitch.app.api.ApiJson
import com.paddlesnitch.app.api.RecordingMotion
import com.paddlesnitch.app.api.RollHistogram
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// What the Boat motion screen shows, from the contract's golden answers (README § Boat motion).
class BoatMotionTest {
    private val dir = File("../../contract/fixtures/api")
    private fun motion(name: String) = ApiJson.decodeFromString(RecordingMotion.serializer(), dir.resolve(name).readText())
    private fun paddle(name: String) = ApiJson.decodeFromString(AnalysisSession.serializer(), dir.resolve(name).readText())
    private val measured = motion("account.devices-session.json").attitude!!

    @Test fun theTilesUseTheServersNumbersAndThePaddlesOwnStrokeRate() {
        val tiles = motionTiles(measured, paddle("paddles.get.json").result.avgSR)
        assertEquals(listOf("Side-to-side roll", "Bow-to-stern pitch", "Evenness", "Stroke rate"), tiles.map { it.label })
        assertEquals(listOf("5.8°", "1.52°", "10%", "64"), tiles.map { it.value })
        assertEquals(listOf("typical lean", "typical tilt", "uneven", "spm"), tiles.map { it.note })
        assertEquals("Side-to-side roll, 5.8 degrees, typical lean", tiles[0].spoken)
        assertEquals("Stroke rate, 64 strokes per minute", tiles[3].spoken)
    }

    @Test fun withNoEvennessOrStrokeRateTheTilesSaySo() {
        val tiles = motionTiles(measured.copy(symmetry = null), null)
        assertEquals("—", tiles[2].value); assertNull(tiles[2].note)
        assertEquals("—", tiles[3].value); assertEquals("not measured", tiles[3].note)
        assertEquals("Stroke rate, not measured", tiles[3].spoken)
    }

    @Test fun onlyAPaddleFromATrackerOffersBoatMotion() {
        assertTrue(hasBoatMotion(paddle("paddles.get.json")))
        assertTrue(hasBoatMotion(paddle("paddles.get.motion-only.json")))
        assertFalse(hasBoatMotion(paddle("paddles.get.strava.json")))
    }

    @Test fun theChartsBoundsAndLabels() {
        assertEquals(10.57, envelopeBound(measured), 0.0)
        assertEquals(10.0, envelopeBound(measured.copy(plotBoundDeg = null)), 0.0)
        assertFalse(envelopeClipped(measured))
        assertTrue(envelopeClipped(measured.copy(plotBoundDeg = 5.0)))
        assertEquals(9.04 * 1.1, excerptBound(measured.excerpt), 1e-9)
        assertEquals("30 s at 10 Hz", excerptLabel(measured))
        assertEquals("30 s", excerptLabel(measured.copy(sampleRateHz = null)))
        assertEquals("9", histogramEdge(measured.rollHistogram!!))
        assertEquals("a few moments went past ±5° and are clipped here", clippedNote(measured.copy(plotBoundDeg = 5.0)))
    }

    @Test fun aSmallExcerptStillHasADegreeOfRoom() =
        assertEquals(1.1, excerptBound(listOf(com.paddlesnitch.app.api.AttitudeSample(0.0, 0.2, -0.1))), 1e-9)

    @Test fun theMirroredLineTakesTheCountOfTheBinNearestTheOtherSide() {
        val bins = listOf(-2.0 to 1L, -1.0 to 5L, 0.0 to 9L, 1.0 to 2L, 2.1 to 7L).map { RollHistogram.Bin(it.first, it.second) }
        assertEquals(listOf(7L, 2L, 9L, 5L, 1L), mirroredCounts(bins))
    }

    @Test fun whyThereIsNoMotion() {
        assertNull(motion("account.devices-session.no-motion.json").attitude)
        assertTrue(noMotionCopy(null).startsWith("Motion data uploads"))
        assertTrue(noMotionCopy(motion("account.devices-session.motion-unusable.json").attitude).startsWith("We couldn’t measure"))
        assertTrue(noMotionCopy(measured.copy(available = false, reason = "")).startsWith("Motion data uploads"))
    }
}
