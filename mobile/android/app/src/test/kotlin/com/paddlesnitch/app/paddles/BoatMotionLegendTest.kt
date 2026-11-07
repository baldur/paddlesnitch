package com.paddlesnitch.app.paddles

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// #855 / contract #887: roll and pitch never differ by colour alone, and their legend words sit
// at the same x on Through the session (swatches) and Stroke shape (lines).
class BoatMotionLegendTest {
    private val sp = 2.625f // a Pixel 7's px per sp at normal text
    private val right = 1000f
    private val rollWidth = 70f
    private val pitchWidth = 88f
    private val words = legendWords(right, rollWidth, pitchWidth, sp)
    private val swatches = legendKeys(words, lines = false, sp)
    private val lines = legendKeys(words, lines = true, sp)

    @Test fun theWordsAreAtTheSameXOnBothCharts() =
        assertEquals(swatches.map { it.wordX }, lines.map { it.wordX })

    @Test fun rollThenPitchTopRight() {
        assertEquals(listOf("roll", "pitch"), swatches.map { it.series })
        assertEquals(listOf("roll", "pitch"), lines.map { it.series })
        assertEquals(right, words.second + pitchWidth, 0.01f)
    }

    @Test fun throughTheSessionKeysAre10spSwatches4spBeforeTheirWord() = swatches.forEach {
        assertEquals(10 * sp, it.keyWidth, 0.01f)
        assertEquals(4 * sp, it.wordX - (it.keyX + it.keyWidth), 0.01f)
    }

    @Test fun strokeShapeKeysAre18spLines6spBeforeTheirWord() = lines.forEach {
        assertEquals(18 * sp, it.keyWidth, 0.01f)
        assertEquals(6 * sp, it.wordX - (it.keyX + it.keyWidth), 0.01f)
    }

    @Test fun pitchsLineKeyClearsTheWordRoll() {
        val rollEnd = words.first + rollWidth
        assertTrue("pitch key at ${lines[1].keyX}, roll ends at $rollEnd", lines[1].keyX - rollEnd >= KEY_SPACE_SP * sp - 0.01f)
    }

    @Test fun theSeriesWidthsAreTheContracts() {
        assertEquals(1.8f, ROLL_LINE_DP)
        assertEquals(1.2f, PITCH_LINE_DP)
        assertEquals(1.2f, OUTLINE_DP)
    }
}
